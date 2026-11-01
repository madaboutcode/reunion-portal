import { useState, useEffect } from "react";

interface FontOption {
  name: string;
  weights: number[];
  variable: boolean;
  googleParam: string;
}

const FONTS: FontOption[] = [
  { name: "Nothing You Could Do", weights: [400], variable: false, googleParam: "Nothing+You+Could+Do" },
  { name: "Oooh Baby", weights: [400], variable: false, googleParam: "Oooh+Baby" },
  { name: "Annie Use Your Telescope", weights: [400], variable: false, googleParam: "Annie+Use+Your+Telescope" },
  { name: "Kristi", weights: [400], variable: false, googleParam: "Kristi" },
  { name: "Caveat Brush", weights: [400], variable: false, googleParam: "Caveat+Brush" },
  { name: "Caveat", weights: [400, 700], variable: true, googleParam: "Caveat:wght@400..700" },
];

const STORAGE_KEY = "smriti_font_picker";

export function FontPicker() {
  const [open, setOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState("Caveat");
  const [weight, setWeight] = useState(400);
  const [letterSpacing, setLetterSpacing] = useState(0);

  // Load all fonts + restore saved state
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const linkId = "smriti-fp-fonts";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      const families = FONTS.map((f) => `family=${f.googleParam}`).join("&");
      link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
      document.head.appendChild(link);
    }

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      if (saved.font) setSelectedFont(saved.font);
      if (saved.weight) setWeight(saved.weight);
      if (saved.letterSpacing !== undefined) setLetterSpacing(saved.letterSpacing);
    } catch { /* ignore malformed localStorage */ }
  }, []);

  // Apply overrides
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // Inline style on documentElement beats @theme layer (highest specificity)
    document.documentElement.style.setProperty("--font-accent", `"${selectedFont}", cursive`);

    // Weight + letter-spacing via style tag with !important
    const styleId = "smriti-fp-style";
    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.textContent = `.font-accent { font-weight: ${weight} !important; letter-spacing: ${letterSpacing}em !important; }`;

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ font: selectedFont, weight, letterSpacing }));
  }, [selectedFont, weight, letterSpacing]);

  if (!import.meta.env.DEV) return null;

  const current = FONTS.find((f) => f.name === selectedFont)!;

  return (
    <div className="fixed fixed-bottom-corner-safe right-4 z-50 font-body">
      <button
        onClick={() => setOpen((o) => !o)}
        className="bg-charcoal/90 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg hover:bg-charcoal transition"
      >
        {open ? "✕" : "Aa"}
      </button>

      {open && (
        <div className="absolute bottom-10 right-0 bg-white border border-black/10 rounded-2xl shadow-2xl p-4 w-72 space-y-4">
          <p className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest">
            Accent Font
          </p>

          {/* Font list — each label renders in its own font */}
          <div className="space-y-0.5">
            {FONTS.map((f) => (
              <button
                key={f.name}
                onClick={() => {
                  setSelectedFont(f.name);
                  setWeight(f.weights[0]);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg transition ${
                  selectedFont === f.name
                    ? "bg-[rgba(215,107,81,0.1)] text-charcoal"
                    : "hover:bg-black/5 text-charcoal/60"
                }`}
                style={{ fontFamily: `"${f.name}", cursive`, fontSize: 20 }}
              >
                {f.name}
              </button>
            ))}
          </div>

          {/* Weight */}
          <div>
            <label className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest block mb-2">
              Weight
            </label>
            {current.variable ? (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={400}
                  max={700}
                  step={50}
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  className="flex-1 accent-[#D76B51]"
                />
                <span className="text-xs text-charcoal/50 w-8 text-right tabular-nums">{weight}</span>
              </div>
            ) : (
              <p className="text-xs text-charcoal/35 italic">Regular 400 only</p>
            )}
          </div>

          {/* Letter spacing */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest">
                Letter spacing
              </label>
              <span className="text-[10px] text-charcoal/40 tabular-nums">
                {letterSpacing > 0 ? "+" : ""}
                {letterSpacing.toFixed(2)}em
              </span>
            </div>
            <input
              type="range"
              min={-0.03}
              max={0.12}
              step={0.01}
              value={letterSpacing}
              onChange={(e) => setLetterSpacing(parseFloat(e.target.value))}
              className="w-full accent-[#D76B51]"
            />
          </div>

          <button
            onClick={() => {
              setSelectedFont("Caveat");
              setWeight(400);
              setLetterSpacing(0);
            }}
            className="text-[10px] text-charcoal/30 hover:text-charcoal/50 transition"
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
