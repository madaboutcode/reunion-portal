import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { Button } from "@/components/ui/Button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { saveAuth, saveStaffAuth, saveVerifyResponse, resolveStaffLanding } from "@/lib/auth";
import { verifyMagicLink, fetchMyPermissions } from "@/lib/staff-api";

// ── SECURITY NOTE ──────────────────────────────────────────────────────────
// Magic codes are single-use. Email scanners (Gmail / Outlook) prefetch links.
// verifyMagicLink MUST only be called on explicit user button click — never on
// page load / mount. This component parses the token from the URL on mount but
// defers the API call until the user presses "Continue to Sign In".
// ──────────────────────────────────────────────────────────────────────────

type Status = "idle" | "verifying" | "success" | "error";

export function AuthVerifyPage() {
  useDocumentTitle("Verify Login");

  const [status, setStatus] = useState<Status>("idle");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Parse on mount — do NOT call the API yet.
  const token = searchParams.get("token");
  const returnTo = searchParams.get("returnTo");

  // No token in URL at all — treat as expired link immediately.
  if (!token) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center px-4">
        <div className="w-full max-w-[380px] text-center">
          <div className="flex justify-center mb-6">
            <SmritiLogo size={48} />
          </div>
          <div
            className="bg-surface border border-border-warm rounded-2xl p-6"
            style={{ boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)" }}
          >
            <p className="font-heading text-lg font-bold text-charcoal mb-2">Link Expired</p>
            <p className="text-sm text-muted mb-6">
              This login link is invalid or has already been used.
            </p>
            <Button variant="primary" onClick={() => navigate("/login")} className="w-full">
              Request a New Login Link
            </Button>
          </div>
        </div>
      </div>
    );
  }

  async function handleContinue() {
    if (!token || status === "verifying") return;

    setStatus("verifying");

    try {
      const response = await verifyMagicLink(token);

      if (response.role === "staff" || response.role === "admin") {
        saveStaffAuth(response.token);
      } else {
        saveAuth(response.token, "");
      }

      saveVerifyResponse({
        role: response.role,
        email: response.email,
        sub: response.sub,
      });

      // Strip token from URL before navigating away
      const cleanParams = new URLSearchParams(searchParams);
      cleanParams.delete("token");
      const cleanPath = cleanParams.size > 0
        ? `${window.location.pathname}?${cleanParams.toString()}`
        : window.location.pathname;
      window.history.replaceState(null, "", cleanPath);

      setStatus("success");

      let destination: string;

      if (response.role === "staff" || response.role === "admin") {
        // Resolve current permissions before navigation (design.md "Post-Login
        // Destination Design"). The server's redirectTo is a fallback hint only
        // and is NOT used to bypass current scope data. A fetch failure never
        // falls back to /staff/dashboard — the scope-free access-denied page
        // with a retry action is the destination.
        try {
          const perms = await fetchMyPermissions();
          const scopes = perms.permissions?.scopes ?? null;
          destination = resolveStaffLanding(scopes, returnTo, response.role);
        } catch {
          destination = "/staff/access-denied?reason=fetch";
        }
      } else {
        destination = returnTo || response.redirectTo || "/";
      }

      navigate(destination, { replace: true });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-[380px] text-center">
        <div className="flex justify-center mb-6">
          <SmritiLogo size={48} />
        </div>

        {(status === "idle" || status === "verifying") && (
          <div
            className="bg-surface border border-border-warm rounded-2xl p-6"
            style={{ boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)" }}
          >
            <p className="font-heading text-lg font-bold text-charcoal mb-2">
              Sign in to Smriti
            </p>
            <p className="text-sm text-muted mb-6">
              Click the button below to verify your login link.
            </p>
            <Button
              variant="primary"
              onClick={handleContinue}
              disabled={status === "verifying"}
              className="w-full"
            >
              {status === "verifying" ? "Verifying..." : "Continue to Sign In"}
            </Button>
          </div>
        )}

        {status === "error" && (
          <div
            className="bg-surface border border-border-warm rounded-2xl p-6"
            style={{ boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)" }}
          >
            <p className="font-heading text-lg font-bold text-charcoal mb-2">Link Expired</p>
            <p className="text-sm text-muted mb-6">
              This login link is invalid or has already been used.
            </p>
            <Button variant="primary" onClick={() => navigate("/login")} className="w-full">
              Request a New Login Link
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
