import { useEffect } from "react";
import { CreditsReel } from "@/components/credits/CreditsReel";

export default function CreditsExportPage() {
  useEffect(() => {
    const banner = document.querySelector(".test-env-banner");
    if (banner) (banner as HTMLElement).style.display = "none";

    // Force portrait gang image regardless of viewport width —
    // removes the media condition so <source> always wins over <img>.
    document.querySelectorAll("picture source[media]").forEach((s) => {
      s.removeAttribute("media");
    });
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      <div
        className="h-full w-full"
        style={{ transform: "scale(1.35)", transformOrigin: "center center" }}
      >
        <CreditsReel />
      </div>
    </div>
  );
}
