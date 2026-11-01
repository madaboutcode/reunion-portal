import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { isStaff, resolveStaffLanding, getAuthRole } from "@/lib/auth";
import { requestMagicLink, fetchMyPermissions } from "@/lib/staff-api";

export default function LoginPage() {
  useDocumentTitle("Login");

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isStaff()) return;
    const returnTo = searchParams.get("returnTo");
    let cancelled = false;
    // Resolve the CURRENT permissions before navigating (design.md "Post-Login
    // Destination Design"). A returnTo is honored only when its required scope
    // is present; a permission fetch failure never falls back to /staff/dashboard.
    fetchMyPermissions()
      .then((res) => {
        if (cancelled) return;
        const scopes = res.permissions?.scopes ?? null;
        navigate(resolveStaffLanding(scopes, returnTo, getAuthRole()), {
          replace: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        navigate("/staff/access-denied?reason=fetch", { replace: true });
      });
    return () => { cancelled = true; };
  }, [navigate, searchParams]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError("");

    try {
      const returnTo = searchParams.get("returnTo") ?? undefined;
      await requestMagicLink(email.trim(), returnTo);
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <SiteNav />

      <main className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
        <div className="w-full max-w-[400px]">
          {/* Logo + title */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <SmritiLogo size={48} />
            </div>
            <h1 className="font-heading text-2xl font-bold text-charcoal">Login</h1>
            <p className="text-sm text-muted mt-2">Enter your email to receive a login link</p>
          </div>

          {/* Form or success message */}
          {sent ? (
            <div
              className="bg-surface border border-border-warm rounded-2xl p-6 text-center"
              style={{ boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)" }}
            >
              <p className="text-sm text-charcoal font-medium">
                If an account exists, a login link has been sent to your email.
              </p>
              <p className="text-xs text-muted mt-3">Check your inbox and spam folder.</p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="bg-surface border border-border-warm rounded-2xl p-6"
              style={{ boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)" }}
            >
              <label className="block text-sm font-semibold text-charcoal mb-1.5">
                Email address
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
              {error && <p className="text-sm text-terracotta mt-2">{error}</p>}
              <Button
                type="submit"
                loading={loading}
                disabled={!email.trim()}
                className="w-full mt-4"
              >
                Send Login Link
              </Button>
            </form>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
