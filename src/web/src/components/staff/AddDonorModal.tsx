import { useState, useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { createDonor } from "@/lib/staff-api";
import { BRANCHES } from "@/lib/constants";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AddDonorModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const BRANCH_OPTIONS = [
  { value: "", label: "Select branch" },
  ...BRANCHES.map((b) => ({ value: b, label: b })),
];

const GENDER_OPTIONS = [
  { value: "", label: "Select" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const INITIAL = {
  fullName: "",
  branch: "",
  donationAmount: "",
  email: "",
  whatsapp: "",
  gender: "",
  city: "",
  country: "India",
  publicAck: false,
  ackDisplayName: "",
  felicitation: false,
};

// ── Component ──────────────────────────────────────────────────────────────

export function AddDonorModal({ open, onClose, onCreated }: AddDonorModalProps) {
  const [form, setForm] = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const set = useCallback(
    <K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) =>
      setForm((f) => ({ ...f, [key]: value })),
    [],
  );

  const canSubmit =
    form.fullName.trim() !== "" &&
    form.branch !== "" &&
    Number(form.donationAmount) > 0;

  function handleClose() {
    if (submitting) return;
    setForm(INITIAL);
    setError("");
    onClose();
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      await createDonor({
        fullName: form.fullName.trim(),
        branch: form.branch,
        donationAmount: Number(form.donationAmount),
        ...(form.email.trim() && { email: form.email.trim() }),
        ...(form.whatsapp.trim() && { whatsapp: form.whatsapp.trim() }),
        ...(form.gender && { gender: form.gender as "male" | "female" }),
        ...(form.city.trim() && { city: form.city.trim() }),
        ...(form.country.trim() && { country: form.country.trim() }),
        publicAck: form.publicAck,
        ...(form.ackDisplayName.trim() && { ackDisplayName: form.ackDisplayName.trim() }),
        felicitation: form.felicitation,
      });
      setForm(INITIAL);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add donor");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl max-w-[520px] w-full overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add Donor"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E8E2DA]">
          <h2 className="font-heading text-lg font-bold text-charcoal">Add Donor</h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Name + Branch */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-charcoal mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-charcoal mb-1">
                Branch <span className="text-red-500">*</span>
              </label>
              <Select
                value={form.branch}
                onChange={(e) => set("branch", e.target.value)}
                options={BRANCH_OPTIONS}
              />
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-charcoal mb-1">
              Donation Amount <span className="text-red-500">*</span>
            </label>
            <Input
              type="number"
              value={form.donationAmount}
              onChange={(e) => set("donationAmount", e.target.value)}
              placeholder="Amount in INR"
              prefix="₹"
            />
          </div>

          {/* Email + WhatsApp */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-charcoal mb-1">Email</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-charcoal mb-1">WhatsApp</label>
              <Input
                type="tel"
                value={form.whatsapp}
                onChange={(e) => set("whatsapp", e.target.value)}
                placeholder="+91..."
              />
            </div>
          </div>

          {/* Gender + City */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-charcoal mb-1">Gender</label>
              <Select
                value={form.gender}
                onChange={(e) => set("gender", e.target.value)}
                options={GENDER_OPTIONS}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-charcoal mb-1">City</label>
              <Input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="City"
              />
            </div>
          </div>

          {/* Country */}
          <div>
            <label className="block text-sm font-semibold text-charcoal mb-1">Country</label>
            <Input
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              placeholder="India"
            />
          </div>

          {/* Acknowledgement toggles */}
          <div className="pt-2 space-y-2">
            <Switch
              checked={form.publicAck}
              onChange={(v) => set("publicAck", v)}
              label="Public acknowledgement"
            />
            {form.publicAck && (
              <div className="pl-14">
                <label className="block text-sm font-semibold text-charcoal mb-1">
                  Display Name
                </label>
                <Input
                  value={form.ackDisplayName}
                  onChange={(e) => set("ackDisplayName", e.target.value)}
                  placeholder="Name to display on programme"
                />
              </div>
            )}
            <Switch
              checked={form.felicitation}
              onChange={(v) => set("felicitation", v)}
              label="Felicitation consent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 font-medium">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#E8E2DA]">
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          >
            Add Donor
          </Button>
        </div>
      </div>
    </div>
  );
}
