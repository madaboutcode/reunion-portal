import { Card, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { getTshirtOptions } from "@/lib/tshirt-options";
import type { Gender, TshirtSize } from "@/lib/staff-types";

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

// Editable t-shirt row — `id` is present for rows already saved on the
// server, absent for rows added locally and not yet saved. `_key` is a
// stable React key that survives across id-less rows (index alone breaks on
// reorder/removal).
export interface TshirtItem {
  _key: string;
  id?: number;
  gender: Gender | null;
  size: TshirtSize;
  isIncluded: boolean;
}

interface TshirtsCardProps {
  tshirts: TshirtItem[];
  costLocked: boolean;
  onChange: (tshirts: TshirtItem[]) => void;
}

export function TshirtsCard({ tshirts, costLocked, onChange }: TshirtsCardProps) {
  const included = tshirts.find((t) => t.isIncluded) ?? null;
  const extras = tshirts.filter((t) => !t.isIncluded);

  function updateItem(key: string, patch: Partial<TshirtItem>) {
    onChange(tshirts.map((t) => (t._key === key ? { ...t, ...patch } : t)));
  }

  function handleGenderChange(t: TshirtItem, gender: Gender) {
    const options = getTshirtOptions(gender);
    const size = options.some((o) => o.value === t.size) ? t.size : "M";
    updateItem(t._key, { gender, size });
  }

  function handleAdd() {
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onChange([...tshirts, { _key: key, gender: "male", size: "M", isIncluded: false }]);
  }

  function handleRemove(key: string) {
    onChange(tshirts.filter((t) => t._key !== key));
  }

  return (
    <Card padding={false}>
      <CardHeader title="T-Shirts" />
      <div className="px-5 pb-4 space-y-4">
        {included && (
          <div>
            <p className="text-[10px] text-muted uppercase tracking-wider mb-1.5">Included Shirt</p>
            <div className="flex flex-wrap items-center gap-2 bg-soft-aqua/15 border border-soft-aqua/50 rounded-xl px-3 py-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-soft-aqua/60 text-charcoal px-2 py-1 rounded-full shrink-0">
                Included
              </span>
              <Select
                value={included.gender ?? "male"}
                onChange={(e) => handleGenderChange(included, e.target.value as Gender)}
                options={GENDER_OPTIONS}
                className="w-28"
              />
              <Select
                value={included.size}
                onChange={(e) => updateItem(included._key, { size: e.target.value as TshirtSize })}
                options={getTshirtOptions(included.gender).map((o) => ({ value: o.value, label: o.label }))}
                className="w-24"
              />
              <span className="ml-auto text-xs text-muted italic">no charge · part of registration</span>
            </div>
          </div>
        )}

        <div>
          <p className="text-[10px] text-muted uppercase tracking-wider mb-1.5">Extra Shirts</p>
          {extras.length === 0 ? (
            <p className="text-sm text-muted py-1">No extra shirts.</p>
          ) : (
            <div className="space-y-2">
              {extras.map((t) => (
                <div
                  key={t._key}
                  className="flex flex-wrap items-center gap-2 border border-border rounded-xl px-3 py-2.5"
                >
                  <Select
                    value={t.gender ?? "male"}
                    onChange={(e) => handleGenderChange(t, e.target.value as Gender)}
                    options={GENDER_OPTIONS}
                    className="w-28"
                  />
                  <Select
                    value={t.size}
                    onChange={(e) => updateItem(t._key, { size: e.target.value as TshirtSize })}
                    options={getTshirtOptions(t.gender).map((o) => ({ value: o.value, label: o.label }))}
                    className="w-24"
                  />
                  <span className="text-sm font-semibold tabular-nums">₹500</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(t._key)}
                    disabled={costLocked}
                    className="ml-auto min-h-11 min-w-11 text-xs text-red-500 hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={costLocked}
          className="text-xs px-3 py-1.5 rounded-lg border border-terracotta/50 text-terracotta font-semibold hover:bg-terracotta/5 disabled:border-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          + Add Extra Shirt
        </button>

        {costLocked && (
          <p className="text-xs text-amber-700">
            Cost-affecting changes locked while payment verification is pending.
          </p>
        )}
      </div>
    </Card>
  );
}
