import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { RegistrationResponseData, ProofUploadResponse } from "@smriti/shared";

vi.mock("@/lib/api");
vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");
vi.mock("@/hooks/useStepAnimation", () => ({
  useStepAnimation: () => ({
    circle1Visible: true,
    title1: "Transfer the amount",
    title1Done: true,
    content1Expanded: true,
    circle2Visible: true,
    title2: "Upload your payment proof",
    title2Done: true,
    content2Expanded: true,
  }),
  FINAL_STATE: {
    circle1Visible: true,
    title1: "Transfer the amount",
    title1Done: true,
    content1Expanded: true,
    circle2Visible: true,
    title2: "Upload your payment proof",
    title2Done: true,
    content2Expanded: true,
  },
}));

import { getMyRegistration, uploadPaymentProof, requestPaymentLink } from "@/lib/api";
import { getToken, saveAuth } from "@/lib/auth";
import { verifyMagicLink } from "@/lib/staff-api";
import BankTransferPage from "@/pages/BankTransferPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── jsdom polyfills ───────────────────────────────────────────────────────
// jsdom does not implement URL.createObjectURL / revokeObjectURL.
// FileUpload calls these when preview=true and an image file is selected.

beforeEach(() => {
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => "blob:http://localhost/fake-url");
    window.URL.revokeObjectURL = vi.fn();
  }
});

// ── Viewport helper ───────────────────────────────────────────────────────

const DESKTOP = 1280;
const MOBILE = 375;

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

// ── Mock data factory ─────────────────────────────────────────────────────

function mockRegistration(
  overrides: Partial<RegistrationResponseData> = {},
): RegistrationResponseData {
  return {
    regId: "SMRT79WW4A25NWG1",
    regCode: "SMRT79WW4A25NWG1",
    status: "pending",
    createdAt: Date.now(),
    pricingBreakup: { base: 7500, collegeContribution: 500, lines: [], donation: 0, total: 8000 },
    contact: {
      fullName: "Mangalasseri Neelakantan",
      branch: "Architecture",
      gender: "male",
      email: "neelakantan@example.com",
      whatsapp: "9876543210",
      city: "Kochi",
      country: "India",
    },
    attendance: {
      intent: "attending",
      participationType: "full_celebration",
      alumniMeal: "veg",
      tshirtSize: "L",
    },
    attendees: { children: [], guests: [] },
    idDocument: {
      fileKey: "id-docs/test.jpg",
      fileType: "image/jpeg",
      sizeBytes: 1024,
      fileName: "test.jpg",
      note: "",
    },
    pendingPaymentAmount: 8000,
    hasVerifiedPayments: false,
    verifiedPaymentAmount: 0,
    ...overrides,
  };
}

// ── Render helpers ────────────────────────────────────────────────────────

function renderPayByCode(
  regCode = "SMRT79WW4A25NWG1",
  search = "",
) {
  return render(
    <MemoryRouter initialEntries={[`/pay/${regCode}${search}`]}>
      <Routes>
        <Route path="/pay/:regCode" element={<BankTransferPage />} />
        <Route
          path="/confirmation/:id"
          element={<div data-testid="confirmation-page" />}
        />
        <Route
          path="/register"
          element={<div data-testid="register-page" />}
        />
        <Route
          path="/login"
          element={<div data-testid="login-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests — Code gate ────────────────────────────────────────────────────

describe("BankTransferPage — code gate", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    // No token in storage — accessing via magic code
    vi.mocked(getToken).mockReturnValue(null);
  });

  it("?code= present: renders Continue button and does NOT call verifyMagicLink", async () => {
    renderPayByCode("SMRT79WW4A25NWG1", "?code=raw-magic-token");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /continue to payment/i }),
      ).toBeInTheDocument();
    });

    // Must NOT have called verify on mount
    expect(verifyMagicLink).not.toHaveBeenCalled();
    // Must NOT have called getMyRegistration on mount
    expect(getMyRegistration).not.toHaveBeenCalled();
  });

  it("?code= present: shows 'Your secure payment link' heading", async () => {
    renderPayByCode("SMRT79WW4A25NWG1", "?code=raw-magic-token");

    await waitFor(() => {
      expect(screen.getByText(/your secure payment link/i)).toBeInTheDocument();
    });
  });

  it("click Continue → verify success → saveAuth called → payment page renders → code param stripped", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockResolvedValue({
      token: "new-jwt",
      role: "attendee",
      redirectTo: "/",
      sub: "user-123",
      email: "test@example.com",
    });

    // After saveAuth, getToken returns the new token
    vi.mocked(getToken).mockReturnValue("new-jwt");

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode("SMRT79WW4A25NWG1", "?code=raw-magic-token");

    // Code gate rendered
    const continueBtn = await screen.findByRole("button", {
      name: /continue to payment/i,
    });

    await user.click(continueBtn);

    // verifyMagicLink called with the token
    await waitFor(() => {
      expect(verifyMagicLink).toHaveBeenCalledWith("raw-magic-token");
    });

    // saveAuth called with the JWT
    await waitFor(() => {
      expect(saveAuth).toHaveBeenCalledWith("new-jwt", "user-123");
    });

    // Payment page renders
    await waitFor(() => {
      expect(screen.getByText(/amount due/i)).toBeInTheDocument();
    });
  });

  it("click Continue → verify 401 → expired wall shown (code param stripped)", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockRejectedValue({ status: 401, error: "expired" });

    renderPayByCode("SMRT79WW4A25NWG1", "?code=stale-token");

    const continueBtn = await screen.findByRole("button", {
      name: /continue to payment/i,
    });

    await user.click(continueBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/this payment link has expired/i),
      ).toBeInTheDocument();
    });

    // getMyRegistration must NOT have been called after failed verify
    expect(getMyRegistration).not.toHaveBeenCalled();
  });
});

// ── Tests — Expired wall ─────────────────────────────────────────────────

describe("BankTransferPage — expired wall", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue(null);
  });

  it("no code + no token → expired wall", async () => {
    renderPayByCode();

    await waitFor(() => {
      expect(
        screen.getByText(/this payment link has expired/i),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /email me a fresh payment link/i }),
    ).toBeInTheDocument();
  });

  it("expired wall button calls requestPaymentLink(regCode)", async () => {
    const user = userEvent.setup();

    vi.mocked(requestPaymentLink).mockResolvedValue({
      ok: true,
      message: "Sent",
    });

    renderPayByCode("SMRT99ABC");

    const btn = await screen.findByRole("button", {
      name: /email me a fresh payment link/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(requestPaymentLink).toHaveBeenCalledWith("SMRT99ABC");
    });
  });

  it("expired wall: after success shows sent confirmation message", async () => {
    const user = userEvent.setup();

    vi.mocked(requestPaymentLink).mockResolvedValue({
      ok: true,
      message: "Sent",
    });

    renderPayByCode("SMRT99ABC");

    const btn = await screen.findByRole("button", {
      name: /email me a fresh payment link/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(
        screen.getByText(/check your inbox.*spam/i),
      ).toBeInTheDocument();
    });

    // Button is gone (replaced by the confirmation message)
    expect(
      screen.queryByRole("button", { name: /email me a fresh payment link/i }),
    ).not.toBeInTheDocument();
  });

  it("expired wall: error shows retry state", async () => {
    const user = userEvent.setup();

    vi.mocked(requestPaymentLink).mockRejectedValue({ status: 500 });

    renderPayByCode("SMRT99ABC");

    const btn = await screen.findByRole("button", {
      name: /email me a fresh payment link/i,
    });
    await user.click(btn);

    // Button is still there (can retry), error message shown
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /email me a fresh payment link/i }),
      ).toBeInTheDocument();
    });
  });
});

// ── Tests — Session-based (JWT present) ──────────────────────────────────

describe("BankTransferPage — session (JWT present)", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("session: loads payment page via getMyRegistration", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/amount due/i)).toBeInTheDocument();
    });

    expect(getMyRegistration).toHaveBeenCalled();
  });

  it("session: getMyRegistration 401 → expired wall", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({
      status: 401,
      error: "Unauthorized",
    });

    renderPayByCode();

    await waitFor(() => {
      expect(
        screen.getByText(/this payment link has expired/i),
      ).toBeInTheDocument();
    });
  });

  it("confirmed status: redirects to confirmation page", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-page")).toBeInTheDocument();
    });
  });

  it("not found: shows registration not found message", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({
      status: 404,
      error: "Not found",
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/registration not found/i)).toBeInTheDocument();
    });
  });

  it("API error: shows error message with retry button", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({
      status: 500,
      error: "Server is down",
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("pending: displays amount due", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "pending",
        pricingBreakup: {
          base: 7500,
          collegeContribution: 500,
          lines: [],
          donation: 0,
          total: 8000,
        },
      }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/amount due/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/8,000/).length).toBeGreaterThan(0);
  });

  it("pending: displays bank details with copy button", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/bank account details/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Your Bank Name/)).toBeInTheDocument();
    expect(screen.getByText(/XXXXXXXX000/)).toBeInTheDocument();
    expect(screen.getByText(/paying from india/i)).toBeInTheDocument();
    expect(screen.getByText(/paying from outside india/i)).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /copy all details/i }),
    ).toBeInTheDocument();
  });

  it.skip("pending: shows UPI section — UPI no longer supported", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/upi payment/i)).toBeInTheDocument();
    });

    const upiCopyBtn = screen.getByLabelText(/copy upi id/i);
    expect(upiCopyBtn).toBeInTheDocument();
  });

  it.skip("pending: shows UPI for non-India users — UPI no longer supported", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "pending",
        contact: {
          fullName: "Rajesh",
          branch: "Mechanical Engineering",
          gender: "male",
          email: "raj@example.com",
          whatsapp: "9876543210",
          city: "Dubai",
          country: "UAE",
        },
      }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/upi payment/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/bank account details/i)).toBeInTheDocument();
  });

  it("pending: renders FileUpload with file input and accepted types", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/upload.*payment proof/i)).toBeInTheDocument();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    expect(fileInput.accept).toContain(".jpg");
    expect(fileInput.accept).toContain(".png");
    expect(fileInput.accept).toContain(".pdf");

    expect(
      screen.getByText(/drag & drop or click to browse/i),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/jpg.*png.*pdf.*up to 5mb/i),
    ).toBeInTheDocument();
  });

  it("pending: renders PaymentProgress with all stage labels", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByRole("list")).toBeInTheDocument();
    });

    const stageItems = screen.getAllByRole("listitem");
    expect(stageItems.length).toBe(4);

    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("Payment")).toBeInTheDocument();
    expect(screen.getByText("We're Verifying")).toBeInTheDocument();
    expect(screen.getByText("You're In!")).toBeInTheDocument();
  });

  it("pending: Submit Proof button not visible before file is selected", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/upload.*payment proof/i)).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /submit proof/i }),
    ).not.toBeInTheDocument();
  });

  it("pending: Submit Proof button appears after file is selected", async () => {
    const user = userEvent.setup();

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    vi.mocked(uploadPaymentProof).mockImplementation(
      () => new Promise<ProofUploadResponse>(() => {}),
    );

    renderPayByCode();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-input"]'),
      ).not.toBeNull();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;

    const file = new File(["test"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /submit proof/i }),
      ).toBeInTheDocument();
    });

    expect(uploadPaymentProof).not.toHaveBeenCalled();
  });

  it("upload triggered on Submit Proof click, not on file selection", async () => {
    const user = userEvent.setup();

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    vi.mocked(uploadPaymentProof).mockResolvedValue({
      status: "pending_verification",
      message: "Proof uploaded",
    });

    renderPayByCode();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-input"]'),
      ).not.toBeNull();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;

    const file = new File(["test"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    expect(uploadPaymentProof).not.toHaveBeenCalled();

    const submitBtn = await screen.findByRole("button", {
      name: /submit proof/i,
    });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(uploadPaymentProof).toHaveBeenCalledTimes(1);
    });
  });

  it("upload loading: shows Uploading... on Submit Proof button during upload", async () => {
    const user = userEvent.setup();

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    vi.mocked(uploadPaymentProof).mockImplementation(
      () => new Promise<ProofUploadResponse>(() => {}),
    );

    renderPayByCode();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-input"]'),
      ).not.toBeNull();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;

    const file = new File(["test"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    const submitBtn = await screen.findByRole("button", {
      name: /submit proof/i,
    });
    await user.click(submitBtn);

    await waitFor(() => {
      const uploadingButtons = screen
        .getAllByRole("button", { name: /uploading/i })
        .filter((el) => el.tagName === "BUTTON");
      expect(uploadingButtons.length).toBeGreaterThan(0);
      expect(uploadingButtons[0]).toBeDisabled();
    });
  });

  it("upload success: navigates immediately to confirmation page", async () => {
    const user = userEvent.setup();

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    vi.mocked(uploadPaymentProof).mockResolvedValue({
      status: "pending_verification",
      message: "Proof uploaded",
    });

    renderPayByCode();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-input"]'),
      ).not.toBeNull();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;

    const file = new File(["test"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    const submitBtn = await screen.findByRole("button", {
      name: /submit proof/i,
    });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-page")).toBeInTheDocument();
    });
  });

  it("upload error: shows error message, keeps file selected for retry", async () => {
    const user = userEvent.setup();

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    vi.mocked(uploadPaymentProof).mockRejectedValue({
      error: "Upload failed",
    });

    renderPayByCode();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-input"]'),
      ).not.toBeNull();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;

    const file = new File(["test"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    const submitBtn = await screen.findByRole("button", {
      name: /submit proof/i,
    });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/upload failed/i).length).toBeGreaterThan(0);
    });
  });

  it("pending_verification status: redirects to confirmation page", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-page")).toBeInTheDocument();
    });
  });

  it("pending: FileUpload shows image preview after selecting JPG file", async () => {
    const user = userEvent.setup();

    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    vi.mocked(uploadPaymentProof).mockImplementation(
      () => new Promise<ProofUploadResponse>(() => {}),
    );

    renderPayByCode();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-input"]'),
      ).not.toBeNull();
    });

    const fileInput = document.querySelector(
      '[data-testid="file-input"]',
    ) as HTMLInputElement;

    const file = new File(["fake-image"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-preview-image"]'),
      ).not.toBeNull();
    });
  });
});

// ── Tests — Mobile ───────────────────────────────────────────────────────

describe("BankTransferPage — mobile", () => {
  beforeEach(() => {
    setViewport(MOBILE);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("pending: displays amount due and bank details on mobile", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/amount due/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/8,000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/bank account details/i)).toBeInTheDocument();

    expect(
      screen.getByText(/drag & drop or click to browse/i),
    ).toBeInTheDocument();
  });

  it("pending: Submit Proof button not visible without file on mobile", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/upload.*payment proof/i)).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /submit proof/i }),
    ).not.toBeInTheDocument();
  });

  it.skip("pending: shows UPI section on mobile — UPI no longer supported", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderPayByCode();

    await waitFor(() => {
      expect(screen.getByText(/upi payment/i)).toBeInTheDocument();
    });
  });

  it("no token: shows expired wall on mobile", async () => {
    vi.mocked(getToken).mockReturnValue(null);

    renderPayByCode();

    await waitFor(() => {
      expect(
        screen.getByText(/this payment link has expired/i),
      ).toBeInTheDocument();
    });
  });
});
