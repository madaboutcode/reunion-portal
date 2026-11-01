import { useState } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { WhosComingView } from "@/components/whos-coming/WhosComingView";
import { MOCK_WHOS_COMING_PEOPLE } from "@/components/whos-coming/mock-data";

type ViewMode = "page" | "loading" | "empty" | "error";

export default function WhosComingDebugPage() {
  useDocumentTitle("Debug: Who's Coming");

  const [mode, setMode] = useState<ViewMode>("page");

  const people = mode === "empty" ? [] : MOCK_WHOS_COMING_PEOPLE;
  const loading = mode === "loading";
  const error = mode === "error" ? "Mock error — failed to load attendees" : null;

  return (
    <>
      <div className="border-b border-charcoal/10 bg-charcoal text-white px-4 py-3">
        <div className="max-w-[900px] mx-auto space-y-2">
          <p className="text-sm font-semibold">Who&apos;s Coming — debug</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["page", "52 mock attendees"],
                ["loading", "Loading shimmer"],
                ["empty", "Empty state"],
                ["error", "Error state"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={[
                  "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px]",
                  mode === key
                    ? "bg-terracotta text-white"
                    : "bg-white/10 text-white/90 hover:bg-white/20",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <WhosComingView
        people={people}
        photosVersion={0}
        loading={loading}
        error={error}
        showDebugBanner
      />
    </>
  );
}
