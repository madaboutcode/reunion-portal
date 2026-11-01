/**
 * Registration-flow test boundaries (wizard + submit + payment redirect).
 * Reuses wizard-flow boundary policy; adds auth + location for ReviewPay.handlePay.
 */
import { vi, beforeEach } from "vitest";
import { useFileUpload } from "@/hooks/useFileUpload";

vi.mock("@/lib/api", () => ({
  checkEmail: vi.fn().mockResolvedValue(false),
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
  getAccommodationAvailability: vi.fn().mockResolvedValue({
    availability: {},
    inventoryConfigured: false,
  }),
  submitRegistration: vi.fn().mockResolvedValue({
    token: "test-jwt",
    regId: "1001",
    regCode: "SMRTTESTREG00001",
    status: "pending",
    pricingBreakup: { base: 8500, collegeContribution: 0, lines: [], donation: 0, total: 8500 },
    paymentUrl: "/pay/SMRTTESTREG00001",
  }),
}));

vi.mock("@/lib/auth", () => ({
  getToken: vi.fn(() => null),
  saveAuth: vi.fn(),
  saveVerifyResponse: vi.fn(),
  clearAuth: vi.fn(),
}));

vi.mock("@/hooks/useFileUpload", () => ({
  useFileUpload: vi.fn(),
}));

vi.mock("@/components/registration/Hero", () => ({
  default: () => <div data-testid="hero" />,
}));
vi.mock("@/components/SiteNav", () => ({
  SiteNav: () => <div data-testid="site-nav" />,
}));
vi.mock("@/components/ui/Stepper", () => ({
  Stepper: () => <div data-testid="stepper" />,
}));
vi.mock("@/components/SiteFooter", () => ({
  SiteFooter: () => <div data-testid="site-footer" />,
}));

beforeEach(() => {
  localStorage.clear();

  vi.mocked(useFileUpload).mockImplementation((_url, _fields, opts) => ({
    uploading: false,
    progress: 0,
    error: "",
    handleFileSelect: (file: File | null) => {
      if (!file) {
        opts.onClear();
        return;
      }
      const key = _url.includes("photo") ? "key-photo" : "key-id";
      opts.onSuccess(key, file);
    },
    handleRemove: () => opts.onClear(),
  }));

  vi.stubGlobal("scrollTo", vi.fn());
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => "blob:mock");
    window.URL.revokeObjectURL = vi.fn();
  }

  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "" },
  });
});