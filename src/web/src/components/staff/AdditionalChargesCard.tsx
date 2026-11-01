import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/format-date";

// Editable charge row — `id`/`createdBy`/`createdAt` are present for rows
// already saved on the server, absent for rows added locally and not yet
// saved. `_key` is a stable React key that survives across id-less rows.
export interface ChargeItem {
  _key: string;
  id?: number;
  description: string;
  amount: number;
  createdBy?: number;
  createdAt?: number;
}

interface AdditionalChargesCardProps {
  charges: ChargeItem[];
  costLocked: boolean;
  onChange: (charges: ChargeItem[]) => void;
}

export function AdditionalChargesCard({ charges, costLocked, onChange }: AdditionalChargesCardProps) {
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const amt = Number(amount);
    if (!description.trim() || !Number.isFinite(amt) || amt <= 0) {
      setError("Enter a description and a positive amount.");
      return;
    }
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onChange([...charges, { _key: key, description: description.trim(), amount: amt }]);
    setDescription("");
    setAmount("");
    setError(null);
    setAdding(false);
  }

  function handleRemove(key: string) {
    onChange(charges.filter((c) => c._key !== key));
  }

  return (
    <Card padding={false}>
      <CardHeader title="Additional Charges" />
      <div className="px-5 pb-4 space-y-3">
        {charges.length === 0 && !adding && (
          <p className="text-sm text-muted py-1">No additional charges yet.</p>
        )}

        {charges.map((c) => (
          <div key={c._key} className="border border-border rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="flex-1 min-w-[140px] text-sm text-charcoal">{c.description}</span>
              <span className="text-sm font-semibold tabular-nums">₹{c.amount.toLocaleString("en-IN")}</span>
              <button
                type="button"
                onClick={() => handleRemove(c._key)}
                disabled={costLocked}
                className="min-h-11 min-w-11 text-xs text-red-500 hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed shrink-0"
              >
                Remove
              </button>
            </div>
            {c.createdBy !== undefined && c.createdAt !== undefined ? (
              <p className="text-[11px] text-muted">
                Added by: <span className="font-medium text-charcoal">Staff #{c.createdBy}</span> · {formatDate(c.createdAt)}
              </p>
            ) : (
              <p className="text-[11px] text-terracotta italic">Not yet saved</p>
            )}
          </div>
        ))}

        {adding ? (
          <div className="border border-border rounded-xl p-3 space-y-2">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">₹</span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min={1}
                placeholder="Amount"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleAdd}>
                Add
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { setAdding(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={costLocked}
            className="text-xs px-3 py-1.5 rounded-lg border border-terracotta/50 text-terracotta font-semibold hover:bg-terracotta/5 disabled:border-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            + Add Charge
          </button>
        )}

        <p className="text-[11px] text-muted pt-1">
          Charges are added to total amount. Description is visible to the registrant.
        </p>
      </div>
    </Card>
  );
}
