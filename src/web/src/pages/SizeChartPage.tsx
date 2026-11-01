import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SmritiLogo } from "@/components/ui/SmritiLogo";

const MENS_SIZES = [
  { label: "XS", chest: 34, length: 25, shoulder: 15 },
  { label: "S", chest: 36, length: 27, shoulder: 15.75 },
  { label: "M", chest: 38, length: 28, shoulder: 16.5 },
  { label: "L", chest: 40, length: 28, shoulder: 17.25 },
  { label: "XL", chest: 42, length: 29, shoulder: 18 },
  { label: "2XL", chest: 44, length: 30, shoulder: 18.75 },
  { label: "3XL", chest: 46, length: 31, shoulder: 19.5 },
  { label: "4XL", chest: 48, length: 32, shoulder: 20.3 },
  { label: "5XL", chest: 50, length: 32, shoulder: 21 },
];

const WOMENS_SIZES = [
  { label: "2XS", chest: 30, length: 22, shoulder: 13.5 },
  { label: "XS", chest: 32, length: 23, shoulder: 14 },
  { label: "S", chest: 34, length: 24, shoulder: 14.5 },
  { label: "M", chest: 36, length: 25, shoulder: 15 },
  { label: "L", chest: 38, length: 26, shoulder: 15.75 },
  { label: "XL", chest: 40, length: 27, shoulder: 16.5 },
  { label: "2XL", chest: 42, length: 28, shoulder: 17.38 },
  { label: "3XL", chest: 44, length: 29, shoulder: 18.13 },
  { label: "4XL", chest: 46, length: 29, shoulder: 18.9 },
];

function SizeTable({
  title,
  sizes,
}: {
  title: string;
  sizes: typeof MENS_SIZES;
}) {
  return (
    <div>
      <h2 className="font-heading text-base font-bold text-charcoal mb-3">
        {title}
      </h2>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm border-collapse min-w-[320px]">
          <thead>
            <tr className="bg-charcoal text-white">
              <th className="py-2.5 px-3 text-left font-semibold rounded-tl-lg">Size</th>
              <th className="py-2.5 px-3 text-center font-semibold">Chest</th>
              <th className="py-2.5 px-3 text-center font-semibold">Length</th>
              <th className="py-2.5 px-3 text-center font-semibold rounded-tr-lg">Shoulder</th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((s, i) => (
              <tr
                key={s.label}
                className={i % 2 === 0 ? "bg-white" : "bg-stone-50"}
              >
                <td className="py-2 px-3 font-semibold text-charcoal">{s.label}</td>
                <td className="py-2 px-3 text-center text-muted">{s.chest}</td>
                <td className="py-2 px-3 text-center text-muted">{s.length}</td>
                <td className="py-2 px-3 text-center text-muted">{s.shoulder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between mt-2 px-1">
        <p className="text-xs text-terracotta font-medium">Tolerance +/- 1 inch</p>
        <p className="text-xs text-terracotta font-medium">All measurements in inches</p>
      </div>
    </div>
  );
}

function MeasurementDiagram() {
  return (
    <div className="bg-white rounded-xl border border-border-warm p-4">
      <h2 className="font-heading text-base font-bold text-charcoal mb-3">
        How to Measure
      </h2>
      <img
        src="/assets/how-to-measure.png"
        alt="T-shirt measurement diagram showing chest, length (HSP), shoulder, and sleeve measurement points"
        className="w-full"
        loading="lazy"
      />
    </div>
  );
}

type GenderTab = "male" | "female";

export default function SizeChartPage() {
  useDocumentTitle("T-Shirt Size Chart");
  const [params] = useSearchParams();
  const genderParam = params.get("g");
  const initialTab: GenderTab = genderParam === "female" ? "female" : "male";
  const [tab, setTab] = useState<GenderTab>(initialTab);

  return (
    <div className="min-h-screen bg-page">
      <div className="max-w-[560px] mx-auto px-5 py-8">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <SmritiLogo size={80} href="/" />
        </div>

        {/* Title */}
        <h1 className="font-heading text-xl font-bold text-charcoal text-center mb-6">
          T-Shirt Size Chart
        </h1>

        {/* Measurement diagram */}
        <div className="mb-6">
          <MeasurementDiagram />
        </div>

        {/* Gender tabs */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab("male")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
              tab === "male"
                ? "bg-charcoal text-white"
                : "bg-white text-muted border border-border-warm hover:border-charcoal"
            }`}
          >
            Men&rsquo;s
          </button>
          <button
            type="button"
            onClick={() => setTab("female")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
              tab === "female"
                ? "bg-charcoal text-white"
                : "bg-white text-muted border border-border-warm hover:border-charcoal"
            }`}
          >
            Women&rsquo;s
          </button>
        </div>

        {/* Size table */}
        <div className="bg-white rounded-xl border border-border-warm p-4 mb-6">
          {tab === "male" ? (
            <SizeTable title="Men's (Set-in & Raglan)" sizes={MENS_SIZES} />
          ) : (
            <SizeTable title="Women's (Set-in & Raglan)" sizes={WOMENS_SIZES} />
          )}
        </div>

        <p className="text-xs text-muted text-center leading-relaxed">
          Each brand&rsquo;s sizes are unique and label size comparisons may not be exact.
          Please cross-check with this size chart to find your fit.
        </p>
      </div>
    </div>
  );
}
