import { useState, useCallback } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ThankYouCard } from "@/components/confirmation/ThankYouCard";
import { EntryPassCard } from "@/components/confirmation/EntryPassCard";

type Tab = "donation-desktop" | "donation-mobile" | "donation-long" | "pass-desktop" | "pass-mobile";

const TABS: { key: Tab; label: string }[] = [
  { key: "donation-desktop", label: "Donation · Desktop" },
  { key: "donation-mobile", label: "Donation · Mobile" },
  { key: "donation-long", label: "Donation · Long Name" },
  { key: "pass-desktop", label: "Pass · Desktop" },
  { key: "pass-mobile", label: "Pass · Mobile" },
];

export default function DonationCardDebugPage() {
  useDocumentTitle("Confirmation Cards Debug");
  const [tab, setTab] = useState<Tab>("donation-desktop");
  const [animKey, setAnimKey] = useState(0);

  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    setAnimKey((k) => k + 1);
  }, []);

  return (
    <div className="min-h-screen bg-page">
      <header className="bg-charcoal text-white p-4">
        <h1 className="font-heading text-xl font-bold">Confirmation Cards</h1>
        <p className="text-subtle text-sm mt-1 font-body">Click a tab to replay the animation</p>
      </header>

      <nav className="flex gap-1 p-3 bg-surface border-b border-border-warm overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === key ? "bg-terracotta text-white" : "text-muted hover:bg-soft-aqua-light"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="flex justify-center items-start py-12 px-4" style={{ minHeight: "calc(100vh - 120px)" }}>
        <div key={animKey}>
          {tab === "donation-desktop" && (
            <ThankYouCard name="John Honai" amount="₹5,000" size="desktop" />
          )}
          {tab === "donation-mobile" && (
            <div className="border border-border-warm rounded-xl overflow-hidden" style={{ width: 375 }}>
              <div className="bg-page p-4 flex justify-center py-8">
                <ThankYouCard name="John Honai" amount="₹5,000" size="mobile" />
              </div>
            </div>
          )}
          {tab === "donation-long" && (
            <ThankYouCard name="Alex Example Donor" amount="₹25,000" size="desktop" />
          )}
          {tab === "pass-desktop" && (
            <EntryPassCard reg="SM-2006-0042" name="John Honai" size="desktop" />
          )}
          {tab === "pass-mobile" && (
            <div className="border border-border-warm rounded-xl overflow-hidden" style={{ width: 375 }}>
              <div className="bg-page p-4 flex justify-center py-8">
                <EntryPassCard reg="SM-2006-0042" name="John Honai" size="mobile" />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
