import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import type { StaffRegistrationDetailResponse } from "@/lib/staff-types";

vi.mock("@/lib/staff-api");

import {
  fetchFile,
  fetchRefunds,
  fetchRegistrationDetail,
  replacePhoto,
} from "@/lib/staff-api";
import RegistrationDetailPage from "./RegistrationDetailPage";

const detail: StaffRegistrationDetailResponse = {
  registration: {
    id: 42,
    regCode: "SMRT00042",
    status: "confirmed",
    fullName: "Omar M",
    email: "omar@example.com",
    whatsapp: "9876543210",
    branch: "Computer Science & Engineering",
    city: "Kochi",
    country: "India",
    gender: "female",
    mobileAlternate: null,
    attendance: {
      intent: "attending",
      participationType: "full_celebration",
      mealPreference: "veg",
      tshirtSize: "M",
    },
    accommodation: {
      type: "none",
      checkIn: "",
      checkOut: "",
      extraBed: false,
      breakfastAdult: 0,
      breakfastChild: 0,
    },
    donation: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    pricingBreakup: {
      base: 0,
      collegeContribution: 0,
      lines: [],
      donation: 0,
      total: 0,
    },
    totalAmount: 0,
    idNote: null,
    photoFileKey: "registrations/SMRT00042/photo.jpg",
    photoThumbKey: "registrations/SMRT00042/photo-thumb.jpg",
    createdAt: 1_752_600_000_000,
    updatedAt: 1_752_600_000_000,
  },
  attendees: [],
  payments: [],
  documents: [],
  audit: [],
  tshirts: [],
  additionalCharges: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/staff/registrations/42"]}>
        <Routes>
          <Route path="/staff/registrations/:id" element={<RegistrationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchRegistrationDetail).mockResolvedValue(detail);
  vi.mocked(fetchRefunds).mockResolvedValue({ refunds: [] });
  vi.mocked(fetchFile).mockResolvedValue({
    url: "blob:old-photo",
    contentType: "image/jpeg",
  });
  vi.stubGlobal("open", vi.fn());
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("staff photo replacement", () => {
  it("offers a JPEG/PNG picker in view mode and removes it during Edit", async () => {
    renderPage();

    const picker = await screen.findByLabelText("Choose replacement photo");
    expect(picker).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(screen.getByRole("button", { name: "Replace Photo" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.queryByRole("button", { name: "Replace Photo" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Choose replacement photo")).not.toBeInTheDocument();
  });

  it("submits immediately while retaining the old avatar, then toasts and reloads", async () => {
    const upload = deferred<{ status: "ok"; message: string }>();
    vi.mocked(replacePhoto).mockReturnValue(upload.promise);
    const reloadedDetail: StaffRegistrationDetailResponse = {
      ...detail,
      registration: {
        ...detail.registration,
        photoFileKey: "registrations/SMRT00042/photo.png",
        photoThumbKey: "registrations/SMRT00042/photo-thumb-new.jpg",
        updatedAt: detail.registration.updatedAt + 1,
      },
    };
    vi.mocked(fetchRegistrationDetail)
      .mockResolvedValueOnce(detail)
      .mockResolvedValue(reloadedDetail);
    vi.mocked(fetchFile).mockImplementation(async (key) => ({
      url: key === reloadedDetail.registration.photoThumbKey
        ? "blob:new-photo"
        : "blob:old-photo",
      contentType: "image/jpeg",
    }));
    renderPage();

    const oldAvatar = await screen.findByRole("img", { name: "Profile photo" });
    expect(oldAvatar).toHaveAttribute("src", "blob:old-photo");
    const file = new File(["new-image"], "replacement.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByLabelText("Choose replacement photo"), {
      target: { files: [file] },
    });

    expect(replacePhoto).toHaveBeenCalledWith(42, file);
    expect(screen.getByRole("button", { name: "Loading" })).toBeDisabled();
    expect(screen.getByRole("img", { name: "Profile photo" })).toHaveAttribute(
      "src",
      "blob:old-photo",
    );

    upload.resolve({ status: "ok", message: "Photo updated." });

    expect(await screen.findByRole("alert")).toHaveTextContent("Photo updated.");
    await waitFor(() => expect(fetchRegistrationDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("img", { name: "Profile photo" })).toHaveAttribute(
      "src",
      "blob:new-photo",
    );
  });

  it("shows the server error and returns to an idle picker that can retry", async () => {
    vi.mocked(replacePhoto)
      .mockRejectedValueOnce(new Error("Could not process image"))
      .mockResolvedValueOnce({ status: "ok", message: "Photo updated." });
    renderPage();
    const picker = await screen.findByLabelText("Choose replacement photo");
    const file = new File(["broken"], "broken.png", { type: "image/png" });

    fireEvent.change(picker, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not process image");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replace Photo" })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText("Choose replacement photo"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(replacePhoto).toHaveBeenCalledTimes(2));
  });
});
