import { useState, useCallback, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { GPayLogo } from "@/components/ui/GPayLogo";
import { SiteNav } from "@/components/SiteNav";
import { SlideOver } from "@/components/registration-desk/SlideOver";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/form/FormField";
import { MealToggle } from "@/components/form/MealToggle";
import { FileUpload } from "@/components/ui/FileUpload";
import { Stepper } from "@/components/ui/Stepper";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EstimateSidebar } from "@/components/registration/EstimateSidebar";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { AlumniDetails } from "@/components/registration/AlumniDetails";
import {
  ParticipationStep,
  type ParticipationType,
} from "@/components/registration/ParticipationStep";
import { ParticipationIcon } from "@/components/registration/ParticipationIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { AttendeesMeals } from "@/components/registration/AttendeesMeals";
import { Accommodation } from "@/components/registration/Accommodation";
import { GivingBack } from "@/components/registration/GivingBack";
import { PhotoId } from "@/components/registration/PhotoId";
import { ReviewPay } from "@/components/registration/ReviewPay";
import { createInitialData } from "@/lib/pricing";
import { BRANCHES } from "@/lib/constants";
import type { WizardDraft } from "@/types/registration";
import SmritiHero from "@/components/registration/Hero";
import Confirmation from "@/components/registration/Confirmation";
import { GoalCard } from "@/components/staff/GoalCard";
import { CreditsReel } from "@/components/credits/CreditsReel";
import { DeskArch } from "@/components/registration-desk/DeskArch";
import { DeskSearchPanel } from "@/components/registration-desk/DeskSearchPanel";
import { DeskLedgerDetail } from "@/components/registration-desk/DeskLedgerDetail";
import { DeskResultCard } from "@/components/registration-desk/DeskResultCard";
import type { DeskAttendeeOverview, DeskSearchResult } from "@/lib/staff-types";
import { getTeamFlagEmoji, getTeamFlagCode } from "@/lib/team-flags";
import { countries } from "countries-list";

type ComponentTab =
  | "button"
  | "input"
  | "select"
  | "toggle"
  | "formfield"
  | "mealtoggle"
  | "stepper"
  | "fileupload"
  | "textarea"
  | "card"
  | "badge"
  | "estimatesidebar"
  | "hero"
  | "gpay-overlay"
  | "participation"
  | "alumni-details"
  | "attendees-meals"
  | "accommodation"
  | "giving-back"
  | "photo-id"
  | "review-pay"
  | "confirmation"
  | "goal-card"
  | "flags"
  | "credits"
  | "desk-nav-repro"
  | "desk-ribbon"
  | "desk-checkin";

const TAB_ALIASES: Record<string, string> = {
  step1: "participation",
  step2: "alumni-details",
  step3: "attendees-meals",
  step4: "accommodation",
  step5: "giving-back",
  step6: "photo-id",
  step7: "review-pay",
};

const TABS: { key: ComponentTab; label: string }[] = [
  { key: "button", label: "Button" },
  { key: "input", label: "Input" },
  { key: "select", label: "Select" },
  { key: "toggle", label: "Toggle" },
  { key: "formfield", label: "FormField" },
  { key: "mealtoggle", label: "MealToggle" },
  { key: "stepper", label: "Stepper" },
  { key: "fileupload", label: "FileUpload" },
  { key: "textarea", label: "Textarea" },
  { key: "card", label: "Card" },
  { key: "badge", label: "Badge" },
  { key: "estimatesidebar", label: "EstimateSidebar" },
  { key: "hero", label: "Hero / Header" },
  { key: "gpay-overlay", label: "GPay Overlay" },
  { key: "participation", label: "Participation" },
  { key: "alumni-details", label: "Alumni Details" },
  { key: "attendees-meals", label: "Attendees & Meals" },
  { key: "accommodation", label: "Accommodation" },
  { key: "giving-back", label: "Giving Back" },
  { key: "photo-id", label: "Photo & ID" },
  { key: "review-pay", label: "Review & Pay" },
  { key: "confirmation", label: "Confirmation" },
  { key: "goal-card", label: "GoalCard" },
  { key: "flags", label: "Flags" },
  { key: "credits", label: "CreditsReel" },
  { key: "desk-nav-repro", label: "Desk Nav Repro" },
  { key: "desk-ribbon", label: "Desk Ribbon" },
  { key: "desk-checkin", label: "Desk Check-in" },
];

function ButtonDemo() {
  const [loading, setLoading] = useState(false);

  const variants = ["primary", "secondary", "ghost"] as const;
  const sizes = ["sm", "md", "lg"] as const;

  const gridLayout = "grid grid-cols-[80px_1fr_1fr_1fr] gap-3 items-center";

  return (
    <div className="space-y-10">
      {/* Variants & Sizes */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Variants &amp; Sizes
        </h3>
        <div className="space-y-2">
          {/* Column headers */}
          <div className={gridLayout}>
            <span />
            {sizes.map((s) => (
              <span
                key={s}
                className="text-xs text-muted font-semibold text-center uppercase"
              >
                {s}
              </span>
            ))}
          </div>
          {/* Rows */}
          {variants.map((variant) => (
            <div key={variant} className={gridLayout}>
              <span className="text-xs text-muted font-semibold capitalize">
                {variant}
              </span>
              {sizes.map((size) => (
                <Button
                  key={`${variant}-${size}`}
                  variant={variant}
                  size={size}
                  onClick={() => {}}
                >
                  {size}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Disabled */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Disabled
        </h3>
        <div className="space-y-2">
          <div className={gridLayout}>
            <span />
            {sizes.map((s) => (
              <span
                key={s}
                className="text-xs text-muted font-semibold text-center uppercase"
              >
                {s}
              </span>
            ))}
          </div>
          {variants.map((variant) => (
            <div key={variant} className={gridLayout}>
              <span className="text-xs text-muted font-semibold capitalize">
                {variant}
              </span>
              {sizes.map((size) => (
                <Button
                  key={`${variant}-${size}-disabled`}
                  variant={variant}
                  size={size}
                  disabled
                >
                  {size}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Loading */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Loading (click to test)
        </h3>
        <div className={gridLayout}>
          <span className="text-xs text-muted font-semibold capitalize">
            md
          </span>
          {variants.map((variant) => (
            <Button
              key={`${variant}-loading`}
              variant={variant}
              size="md"
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 2000);
              }}
            >
              Click Me
            </Button>
          ))}
          <span />
        </div>
      </section>

      {/* Long Label */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Long Label
        </h3>
        <Button variant="primary" size="lg">
          This is a very long button label that should be handled gracefully
        </Button>
      </section>
    </div>
  );
}

function InputDemo() {
  const [textValue, setTextValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [telValue, setTelValue] = useState("");
  const [numValue, setNumValue] = useState("");
  const [disabledValue, setDisabledValue] = useState("Can't touch this");
  const [readOnlyValue, setReadOnlyValue] = useState("Read-only value");

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Text (default)
        </h3>
        <div className="max-w-sm">
          <Input
            placeholder="Enter your full name"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Email
        </h3>
        <div className="max-w-sm">
          <Input
            type="email"
            placeholder="you@example.com"
            value={emailValue}
            onChange={(e) => setEmailValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Tel with prefix
        </h3>
        <div className="max-w-sm">
          <Input
            type="tel"
            prefix="+91"
            placeholder="Phone number"
            value={telValue}
            onChange={(e) => setTelValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Number (spinners hidden)
        </h3>
        <div className="max-w-sm">
          <Input
            type="number"
            placeholder="0"
            value={numValue}
            onChange={(e) => setNumValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Disabled
        </h3>
        <div className="max-w-sm">
          <Input
            disabled
            value={disabledValue}
            onChange={(e) => setDisabledValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Read-only
        </h3>
        <div className="max-w-sm">
          <Input
            readOnly
            value={readOnlyValue}
            onChange={(e) => setReadOnlyValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Error (terracotta border)
        </h3>
        <div className="max-w-sm">
          <Input
            error
            placeholder="This field has an error"
            value="bad value"
            onChange={() => {}}
          />
        </div>
      </section>
    </div>
  );
}

function TextareaDemo() {
  const [textValue, setTextValue] = useState("");
  const [filledValue, setFilledValue] = useState(
    "Hello! I would love to attend the Smriti 2026 reunion.\n\nIt's been 10 years since I visited the campus. Looking forward to meeting everyone!",
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Default with placeholder
        </h3>
        <div className="max-w-md">
          <Textarea
            placeholder="Share your memories or a message for the batch…"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          With value
        </h3>
        <div className="max-w-md">
          <Textarea
            value={filledValue}
            onChange={(e) => setFilledValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Error (terracotta border)
        </h3>
        <div className="max-w-md">
          <Textarea
            error
            placeholder="This field has an error"
            value="Missing required message"
            onChange={() => {}}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Disabled
        </h3>
        <div className="max-w-md">
          <Textarea
            disabled
            value="This message has already been submitted and cannot be edited."
            onChange={() => {}}
          />
        </div>
      </section>
    </div>
  );
}

function SelectDemo() {
  const [selected, setSelected] = useState<string>("");
  const [preSelected, setPreSelected] = useState<string>(BRANCHES[0]);
  const [disabledValue, setDisabledValue] = useState<string>(BRANCHES[2]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Default (with placeholder)
        </h3>
        <div className="max-w-sm">
          <Select
            placeholder="Select your branch"
            options={BRANCHES}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          With BRANCHES options
        </h3>
        <div className="max-w-sm">
          <Select
            options={BRANCHES}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Pre-selected value
        </h3>
        <div className="max-w-sm">
          <Select
            options={BRANCHES}
            value={preSelected}
            onChange={(e) => setPreSelected(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Disabled
        </h3>
        <div className="max-w-sm">
          <Select
            disabled
            options={BRANCHES}
            value={disabledValue}
            onChange={(e) => setDisabledValue(e.target.value)}
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Error (terracotta border)
        </h3>
        <div className="max-w-sm">
          <Select
            error
            placeholder="Select your branch"
            options={BRANCHES}
            value=""
            onChange={() => {}}
          />
        </div>
      </section>
    </div>
  );
}

function ToggleDemo() {
  const [basic, setBasic] = useState("a");
  const [meal, setMeal] = useState("veg");
  const [disabledVal, setDisabledVal] = useState("a");

  const basicOptions = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ];

  const mealOptions = [
    { value: "veg", label: "Veg", icon: "\uD83C\uDF3F" },
    { value: "non_veg", label: "Non-veg", icon: "\uD83C\uDF57" },
  ];

  const mealActiveClass = (v: string) =>
    v === "veg"
      ? "bg-veg-bg border-veg-border text-veg-text"
      : "bg-nonveg-bg border-nonveg-border text-nonveg-text";

  return (
    <div className="space-y-10">
      {/* Basic Toggle */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Basic (no colors)
        </h3>
        <div className="max-w-xs">
          <Toggle options={basicOptions} value={basic} onChange={setBasic} />
          <p className="mt-2 text-xs text-muted">
            Selected: <span className="font-semibold">{basic}</span>
          </p>
        </div>
      </section>

      {/* Veg / Non-veg */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Veg / Non-veg (activeClass)
        </h3>
        <div className="max-w-xs">
          <Toggle
            options={mealOptions}
            value={meal}
            onChange={setMeal}
            activeClass={mealActiveClass}
          />
          <p className="mt-2 text-xs text-muted">
            Selected:{" "}
            <span className="font-semibold">
              {meal === "veg" ? "Veg" : "Non-veg"}
            </span>
          </p>
        </div>
      </section>

      {/* Disabled */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Disabled
        </h3>
        <div className="max-w-xs">
          <Toggle
            options={basicOptions}
            value={disabledVal}
            onChange={setDisabledVal}
            disabled
          />
          <p className="mt-2 text-xs text-muted">
            Interaction blocked — value stays{" "}
            <span className="font-semibold">{disabledVal}</span>
          </p>
        </div>
      </section>
    </div>
  );
}

function MealToggleDemo() {
  const [meal, setMeal] = useState<"veg" | "non_veg">("veg");

  return (
    <div className="space-y-10">
      {/* Interactive */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Interactive (click to toggle)
        </h3>
        <div className="max-w-xs">
          <MealToggle value={meal} onChange={setMeal} />
          <p className="mt-2 text-xs text-muted">
            Current value:{" "}
            <span className="font-semibold">
              {meal === "veg" ? "Veg" : "Non-veg"}
            </span>
          </p>
        </div>
      </section>

      {/* Veg selected (static demo) */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Veg selected
        </h3>
        <div className="max-w-xs">
          <MealToggle value="veg" onChange={() => {}} />
        </div>
      </section>

      {/* Non-veg selected (static demo) */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Non-veg selected
        </h3>
        <div className="max-w-xs">
          <MealToggle value="non_veg" onChange={() => {}} />
        </div>
      </section>
    </div>
  );
}

function FileUploadDemo() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");

  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);
    setError("");
  }, []);

  return (
    <div className="space-y-10">
      {/* Default empty state */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Default (empty)
        </h3>
        <div className="max-w-md">
          <FileUpload onFileSelect={handleFileSelect} />
        </div>
      </section>

      {/* With real file selection */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Interactive (select a real file)
        </h3>
        <div className="max-w-md">
          <FileUpload onFileSelect={handleFileSelect} />
          {selectedFile && (
            <p className="mt-2 text-xs text-muted">
              Last selected:{" "}
              <span className="font-semibold text-charcoal">
                {selectedFile.name}
              </span>{" "}
              ({selectedFile.type || "unknown type"})
            </p>
          )}
        </div>
      </section>

      {/* Error state via external prop */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Error (external prop)
        </h3>
        <div className="max-w-md space-y-3">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setError("File too large. Max 5MB.")}
            >
              Show size error
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setError("Invalid file type. Accepted: JPG, PNG, PDF.")
              }
            >
              Show type error
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setError("")}>
              Clear
            </Button>
          </div>
          <FileUpload onFileSelect={handleFileSelect} error={error} />
        </div>
      </section>

      {/* Disabled */}
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Disabled
        </h3>
        <div className="max-w-md">
          <FileUpload onFileSelect={() => {}} disabled />
        </div>
      </section>
    </div>
  );
}

function FormFieldDemo() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("123");
  const [branch, setBranch] = useState("");

  return (
    <div className="space-y-8 max-w-sm">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Label + Required
        </h3>
        <FormField label="Full Name" required>
          <Input
            placeholder="Enter your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          With Hint
        </h3>
        <FormField
          label="Email Address"
          hint="We'll send your registration confirmation here"
        >
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          With Error
        </h3>
        <FormField
          label="Mobile Number"
          required
          error="Please enter a valid 10-digit mobile number"
        >
          <Input
            type="tel"
            prefix="+91"
            placeholder="Phone number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            error
          />
        </FormField>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Wrapping Select
        </h3>
        <FormField label="Branch" required>
          <Select
            placeholder="Select your branch"
            options={BRANCHES}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        </FormField>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          No Label
        </h3>
        <FormField hint="This field has no visible label">
          <Input placeholder="Optional field" value="" onChange={() => {}} />
        </FormField>
      </section>
    </div>
  );
}

function StepperDemo() {
  return (
    <div className="space-y-8">
      {([1, 2, 3, 4, 5, 6, 7] as const).map((step) => (
        <section key={step}>
          <h3 className="text-xs text-muted font-semibold mb-2 uppercase tracking-wide">
            Step {step}
          </h3>
          <div className="border border-border rounded-xl overflow-hidden">
            <Stepper currentStep={step} />
          </div>
        </section>
      ))}
    </div>
  );
}

function CardDemo() {
  return (
    <div className="space-y-8 max-w-lg">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Card with CardHeader (icon + title + action + accent)
        </h3>
        <Card>
          <CardHeader
            icon={
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            }
            title="Personal Details"
            action={
              <button className="text-xs font-semibold text-terracotta hover:underline">
                Edit
              </button>
            }
            accent="var(--color-terracotta)"
          />
          <p className="text-sm text-muted px-5 py-3">
            This is the card body content. The header above uses the terracotta
            accent strip.
          </p>
        </Card>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Card without header (default padding)
        </h3>
        <Card>
          <p className="text-sm text-muted">
            A simple card with just a paragraph of content. No header, just the
            warm white surface, subtle border, and soft shadow.
          </p>
        </Card>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Card with header + action button (aqua accent)
        </h3>
        <Card>
          <CardHeader
            title="Accommodation"
            action={
              <button className="text-xs font-semibold text-terracotta hover:underline">
                Edit
              </button>
            }
            accent="var(--color-soft-aqua)"
          />
          <p className="text-sm text-muted px-5 py-3">
            The header uses the soft-aqua accent strip{" "}
            <Badge variant="info">Optional</Badge>
          </p>
        </Card>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Card without padding (padding=false)
        </h3>
        <Card padding={false}>
          <div className="bg-soft-aqua-light px-5 py-4 rounded-t-2xl">
            <span className="text-sm font-semibold">
              Custom layout — no built-in padding
            </span>
          </div>
          <p className="text-sm text-muted p-5">
            Use padding=false when you need full control over inner spacing and
            layout.
          </p>
        </Card>
      </section>
    </div>
  );
}

function BadgeDemo() {
  const variants = [
    {
      variant: "success" as const,
      label: "Success",
      desc: "veg-bg / veg-text",
    },
    {
      variant: "warning" as const,
      label: "Warning",
      desc: "amber-100 / amber-800",
    },
    {
      variant: "error" as const,
      label: "Error",
      desc: "terracotta-light / terracotta",
    },
    {
      variant: "info" as const,
      label: "Info",
      desc: "soft-aqua-light / #2A7A80",
    },
    {
      variant: "default" as const,
      label: "Default",
      desc: "gray-100 / gray-600",
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          All Variants
        </h3>
        <div className="space-x-2">
          {variants.map((v) => (
            <Badge key={v.variant} variant={v.variant}>
              {v.label}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Variant Grid with Token Info
        </h3>
        <div className="space-y-3 max-w-sm">
          {variants.map((v) => (
            <div
              key={v.variant}
              className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg"
            >
              <Badge variant={v.variant}>{v.label}</Badge>
              <span className="text-xs text-subtle font-mono">{v.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Inline with Text
        </h3>
        <p className="text-sm text-muted leading-6 max-w-md">
          Your registration is <Badge variant="success">Confirmed</Badge> and
          you have <Badge variant="warning">1 pending payment</Badge>. The
          accommodation request was <Badge variant="error">Rejected</Badge> due
          to capacity.
          <Badge variant="info">New</Badge> option added this week.
        </p>
      </section>
    </div>
  );
}

function EstimateSidebarDemo() {
  const base = createInitialData();

  const alumniOnly: Partial<WizardDraft> = {
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "veg",
    children: [],
    guests: [],
    donationAmount: "",
    collegeContribution: 500,
  };

  const familyPlusKids: Partial<WizardDraft> = {
    ...base,
    fullName: "Test Attendee Two",
    email: "attendee2@example.com",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    spouseName: "Test Spouse One",
    spouseMeal: "veg",
    children: [
      { id: "c1", name: "Test Child One", age: 4, meal: "veg" },
      { id: "c2", name: "Test Child Two", age: 8, meal: "non_veg" },
    ],
    guests: [],
    donationAmount: "",
    collegeContribution: 500,
  };

  const campusOnlySolo: Partial<WizardDraft> = {
    ...base,
    fullName: "Test Attendee Three",
    email: "attendee3@example.com",
    attendanceIntent: "attending",
    participationType: "campus_only",
    alumniMeal: "veg",
    children: [],
    guests: [],
    donationAmount: "",
    collegeContribution: 500,
  };

  const donationOnly: Partial<WizardDraft> = {
    ...base,
    fullName: "Test Attendee Four",
    attendanceIntent: "donation_only",
    participationType: "donation_only",
    donationAmount: "15000",
    children: [],
    guests: [],
    collegeContribution: 0,
  };

  const alumniPlusGuestsDonation: Partial<WizardDraft> = {
    ...base,
    fullName: "Test Attendee Five",
    email: "attendee5@example.com",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "veg",
    children: [],
    guests: [
      { id: "g1", name: "Test Guest One", relationship: "Friend", meal: "non_veg" },
      { id: "g2", name: "Test Guest Two", relationship: "Cousin", meal: "veg" },
    ],
    donationAmount: "2000",
    collegeContribution: 500,
  };

  const scenarios = [
    { label: "Alumni only", data: alumniOnly },
    { label: "Alumni + Spouse + 2 Kids", data: familyPlusKids },
    { label: "Campus Only (Solo)", data: campusOnlySolo },
    { label: "Donation only", data: donationOnly },
    { label: "Alumni + Guests + Donation", data: alumniPlusGuestsDonation },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Each card renders the EstimateSidebar with different mocked{" "}
        <code className="text-charcoal bg-soft-aqua-light px-1 rounded">
          WizardDraft
        </code>{" "}
        scenarios.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 auto-rows-min">
        {scenarios.map((sc) => (
          <div key={sc.label} className="flex flex-col">
            <h3 className="font-heading text-sm font-semibold text-charcoal mb-3">
              {sc.label}
            </h3>
            <div className="w-full max-w-[320px]">
              <EstimateSidebar data={sc.data as WizardDraft} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroDemo() {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          SmritiLogo — sizes
        </h3>
        <div className="flex items-center gap-6 flex-wrap">
          {[30, 46, 60, 64, 80].map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <SmritiLogo size={s} />
              <span className="text-[10px] text-subtle font-mono">{s}px</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          SmritiHero — Step 1 hero (resize below 768px for mobile)
        </h3>
        <div className="border border-border-warm rounded-xl overflow-hidden">
          <SmritiHero />
        </div>
      </section>
    </div>
  );
}

const PARTICIPATION_LABELS: Record<ParticipationType, string> = {
  full_celebration: "Full Celebration",
  campus_only: "Campus Celebration",
  donation_only: "Donation Only",
};

const PARTICIPATION_PRICES: Record<ParticipationType, string> = {
  full_celebration: "₹8,500",
  campus_only: "₹5,500",
  donation_only: "Choose amount",
};

function ParticipationSidebarPreview({
  value,
}: {
  value: ParticipationType | null;
}) {
  if (value == null) {
    return (
      <p className="text-sm text-muted p-5 bg-white rounded-2xl border border-border-warm shadow-sm">
        Select a plan to preview the sidebar.
      </p>
    );
  }

  const total =
    value === "donation_only" ? "Choose amount" : PARTICIPATION_PRICES[value];

  return (
    <div className="p-5 bg-white rounded-2xl border border-border-warm shadow-[0_4px_28px_rgba(80,60,40,0.08)]">
      <p className="font-heading text-sm font-bold text-charcoal mb-4 flex items-center gap-1.5">
        <ParticipationIcon name="heart" size={16} className="text-terracotta" />
        Your selection
      </p>
      <p className="text-xs text-subtle mb-1">Selected plan</p>
      <p className="text-sm font-semibold text-charcoal mb-4 flex items-center gap-1.5">
        <ParticipationIcon name="people-group" size={16} className="text-terracotta" />
        {PARTICIPATION_LABELS[value]}
      </p>
      {value !== "donation_only" && (
        <>
          <div className="flex justify-between text-sm text-muted mb-1">
            <span>{PARTICIPATION_LABELS[value]}</span>
            <span>{PARTICIPATION_PRICES[value]}</span>
          </div>
          <div className="flex justify-between text-sm text-muted mb-3">
            <span>Batch Contribution to College</span>
            <span className="text-subtle">Included</span>
          </div>
        </>
      )}
      <div className="flex justify-between font-bold text-charcoal pt-3 border-t border-border">
        <span>Total</span>
        <span className="text-terracotta">{total}</span>
      </div>
      {value === "full_celebration" && (
        <p className="text-[11px] text-subtle mt-3">1 attendee · Full reunion day</p>
      )}
    </div>
  );
}

function GPayOverlayStandalone({
  upiId,
  amount,
  onClose,
}: {
  upiId: string;
  amount: string;
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyValue = useCallback((field: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedField(field);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedField(null), 1500);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-t-2xl shadow-2xl px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <GPayLogo size={20} />
            <span className="font-heading text-base font-bold text-charcoal">
              Pay with Google Pay
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-charcoal/8 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-muted mb-4">
          Open Google Pay, tap <strong>New payment</strong>, enter the UPI ID and amount below.
        </p>

        <div className="space-y-3 mb-5">
          <div className="rounded-xl border border-border-warm bg-page/60 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle mb-1">
              UPI ID
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold font-mono text-charcoal">{upiId}</span>
              <button
                type="button"
                onClick={() => copyValue("upi", upiId)}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-soft-aqua/30 text-xs font-bold text-[#2A7A80] hover:bg-soft-aqua/50 transition-colors cursor-pointer"
              >
                {copiedField === "upi" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border-warm bg-page/60 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle mb-1">
              Amount
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold font-mono text-charcoal">{amount}</span>
              <button
                type="button"
                onClick={() => copyValue("amount", amount.replace(/[^\d.]/g, ""))}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-soft-aqua/30 text-xs font-bold text-[#2A7A80] hover:bg-soft-aqua/50 transition-colors cursor-pointer"
              >
                {copiedField === "amount" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <a
          href="gpay://upi"
          className="flex items-center justify-center gap-2.5 w-full h-12 rounded-xl text-sm font-bold no-underline bg-charcoal text-white hover:brightness-110 transition"
        >
          <GPayLogo size={18} />
          Open Google Pay
        </a>
      </div>
    </div>,
    document.body,
  );
}

function GPayOverlayDemo() {
  const [showOverlay, setShowOverlay] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        GPay deep links don&apos;t work from a browser. This overlay shows UPI ID + amount
        with copy buttons so the user can pay manually in GPay.
      </p>
      <button
        type="button"
        onClick={() => setShowOverlay(true)}
        className="flex items-center justify-center gap-2.5 w-full max-w-sm h-11 rounded-xl px-4 text-sm font-bold transition hover:brightness-95 bg-charcoal/8 text-charcoal border border-border-warm cursor-pointer"
      >
        Pay with Google Pay
      </button>
      {showOverlay && (
        <GPayOverlayStandalone
          upiId="yourassociation@bank"
          amount="₹8,500"
          onClose={() => setShowOverlay(false)}
        />
      )}
    </div>
  );
}

function ParticipationDemo() {
  const isMobile = useIsMobile();
  const [value, setValue] = useState<ParticipationType | null>("full_celebration");

  const step = (
    <ParticipationStep
      value={value}
      onChange={(v) => setValue(v)}
    />
  );

  if (isMobile) {
    return (
      <div>
        <section className="mb-6">
          <p className="text-sm text-muted">
            Participation step — resize to 375px for mobile. Sticky Continue mirrors wizard
            chrome (disabled until a plan is selected).
          </p>
        </section>
        <div className="border border-border-warm rounded-xl overflow-hidden">
          <div className="px-3.5 py-4">{step}</div>
          <div className="h-mobile-bottom-spacer" />
          <div className="fixed fixed-bottom-safe left-0 right-0 bg-white border-t border-border p-3 flex gap-3 z-50 shadow-[0_-4px_24px_rgba(31,42,51,0.1)]">
            <Button
              variant="primary"
              size="lg"
              disabled={value == null}
              onClick={() => alert(`Continue with ${value ?? "nothing"}`)}
              className="flex-1"
            >
              Continue →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="mb-6">
        <p className="text-sm text-muted">
          Participation step with EstimateSidebar — test at 1280px desktop and 768px tablet.
        </p>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-8 pt-8 pb-14 animate-step-in">
          <div className="grid grid-cols-[3fr_2fr] gap-7 items-start">
            {step}
            <ParticipationSidebarPreview value={value} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AlumniDetailsDemo() {
  const [data, setData] = useState(createInitialData);

  return (
    <div>
      <section className="mb-6">
        <p className="text-sm text-muted">
          Full About You form with live{" "}
          <code className="text-charcoal bg-soft-aqua-light px-1 rounded">
            update
          </code>{" "}
          state. Resize below 768px to see mobile layout with StickyBottomBar.
        </p>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <AlumniDetails
          data={data}
          update={(changes) => setData((prev) => ({ ...prev, ...changes }))}
          onNext={() => alert("Continue clicked")}
        />
      </div>
    </div>
  );
}

function AttendeesMealsDemo() {
  const base = createInitialData();

  // Attending alumni with spouse + kids + guests
  const [data, setData] = useState<WizardDraft>({
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    branch: "Computer Science & Engineering",
    whatsapp: "9876543210",
    attendanceIntent: "attending",
    alumniMeal: "non_veg",
    spouseName: "Test Spouse Two",
    spouseMeal: "veg",
    children: [
      { id: "c1", name: "Test Child One", age: 4, meal: "veg" },
      { id: "c2", name: "Test Child Two", age: 8, meal: "non_veg" },
    ],
    guests: [
      { id: "g1", name: "Test Guest One", relationship: "Friend", meal: "non_veg" },
    ],
  });

  const [participationType, setParticipationType] = useState<WizardDraft["participationType"]>("full_celebration");

  return (
    <div>
      <section className="mb-6 space-y-2">
        <p className="text-sm text-muted">
          Full Your Group attendees &amp; meals form. Resize below 768px to see mobile layout.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setParticipationType("full_celebration");
              setData((prev) => ({ ...prev, participationType: "full_celebration", attendanceIntent: "attending" }));
            }}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              participationType === "full_celebration"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Full Celebration
          </button>
          <button
            type="button"
            onClick={() => {
              setParticipationType("donation_only");
              setData((prev) => ({ ...prev, participationType: "donation_only", attendanceIntent: "donation_only" }));
            }}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              participationType === "donation_only"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Donation Only
          </button>
        </div>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <AttendeesMeals
          data={data}
          update={(changes) => setData((prev) => ({ ...prev, ...changes }))}
          onNext={() => alert("Continue clicked")}
          onBack={() => alert("Back clicked")}
        />
      </div>
    </div>
  );
}

function GivingBackDemo() {
  const base = createInitialData();
  const [participationType, setParticipationType] = useState<"full_celebration" | "donation_only">("full_celebration");
  const [data, setData] = useState<WizardDraft>({
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    attendanceIntent: "attending",
    participationType: "full_celebration",
  });

  const switchType = (type: "full_celebration" | "donation_only") => {
    setParticipationType(type);
    setData((prev) => ({
      ...prev,
      participationType: type,
      attendanceIntent: type === "donation_only" ? "donation_only" : "attending",
    }));
  };

  return (
    <div>
      <section className="mb-6">
        <p className="text-sm text-muted mb-3">
          Giving Back — shows Section A (college contribution + cause picker) for both types.
          Resize below 768px to see mobile layout with StickyBottomBar.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => switchType("full_celebration")}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              participationType === "full_celebration"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Full Celebration
          </button>
          <button
            type="button"
            onClick={() => switchType("donation_only")}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              participationType === "donation_only"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Donation Only
          </button>
        </div>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <GivingBack
          data={data}
          onChange={(changes: Partial<typeof data>) => setData((prev) => ({ ...prev, ...changes }))}
          onNext={() => alert("Continue clicked")}
          onBack={() => alert("Back clicked")}
        />
      </div>
    </div>
  );
}

function AccommodationDemo() {
  const base = createInitialData();
  const [data, setData] = useState<WizardDraft>({
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    attendanceIntent: "attending",
    participationType: "full_celebration",
  });

  return (
    <div>
      <section className="mb-6">
        <p className="text-sm text-muted">
          Full Your Stay — Accommodation / Stay selection. Resize below 768px to see mobile layout
          with StickyBottomBar.
        </p>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <Accommodation
          data={data}
          update={(changes: Partial<WizardDraft>) => setData((prev) => ({ ...prev, ...changes }))}
          onNext={() => alert("Continue clicked")}
          onBack={() => alert("Back clicked")}
        />
      </div>
    </div>
  );
}

function ReviewPayDemo() {
  const base = createInitialData();
  const [data, setData] = useState<WizardDraft>({
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    branch: "Computer Science & Engineering",
    gender: "male",
    whatsapp: "9876543210",
    city: "Bangalore",
    country: "India",
    attendanceIntent: "attending",
    alumniMeal: "non_veg",
    tshirtSize: "L",
    spouseName: "Test Spouse Two",
    spouseMeal: "veg",
    children: [
      { id: "c1", name: "Test Child One", age: 4, meal: "veg" },
      { id: "c2", name: "Test Child Two", age: 8, meal: "non_veg" },
    ],
    guests: [
      { id: "g1", name: "Test Guest One", relationship: "Friend", meal: "non_veg" },
    ],
    accommodation: "private",
    extraBed: false,
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    donationAmount: "15000",
    publicAcknowledgement: true,
    acknowledgementDisplayName: "Test Attendee One & Family",
    felicitationConsent: false,
    collegeContribution: 500,
    photoFileName: "",
    idFileName: "",
    idNote: "",
  });

  return (
    <div>
      <section className="mb-6 space-y-2">
        <p className="text-sm text-muted">
          Full Review &amp; Pay. Resize below 768px to see mobile layout
          with StickyBottomBar.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                participationType: "full_celebration",
                attendanceIntent: "attending",
                tshirtSize: "L",
              }))
            }
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              data.participationType === "full_celebration"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Full Celebration + Family
          </button>
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                participationType: "donation_only" as const,
                attendanceIntent: "donation_only" as const,
              }))
            }
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              data.participationType === "donation_only"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Donation Only
          </button>
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                photoFileKey: prev.photoFileKey ? undefined : "mock-photo-key-001",
                photoFileType: prev.photoFileKey ? undefined : "image/jpeg",
                photoFileSizeBytes: prev.photoFileKey ? undefined : 98304,
                photoFileName: prev.photoFileKey ? "" : "sample_photo.jpg",
              }))
            }
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-white text-muted border border-border hover:border-terracotta transition-colors"
          >
            Toggle Photo Upload
          </button>
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                idFileKey: prev.idFileKey ? undefined : "mock-id-key-001",
                idFileType: prev.idFileKey ? undefined : "application/pdf",
                idFileSizeBytes: prev.idFileKey ? undefined : 123456,
                idFileName: prev.idFileKey ? "" : "sample_id.pdf",
              }))
            }
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-white text-muted border border-border hover:border-terracotta transition-colors"
          >
            Toggle ID Upload
          </button>
        </div>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <ReviewPay
          data={data}
          update={(changes) => setData((prev) => ({ ...prev, ...changes }))}
          onNext={() => alert("Payment submitted — navigating to bank transfer page")}
          onBack={() => alert("Back clicked")}
          goToStep={(step) => alert(`Navigate to step ${step}`)}
        />
      </div>
    </div>
  );
}

function ConfirmationDemo() {
  const base = createInitialData();

  const mockData: WizardDraft = {
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    branch: "Computer Science & Engineering",
    whatsapp: "+919876543210",
    city: "Bangalore",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    spouseName: "Test Spouse Two",
    spouseMeal: "veg",
    children: [
      { id: "c1", name: "Test Child One", age: 4, meal: "veg" },
      { id: "c2", name: "Test Child Two", age: 8, meal: "non_veg" },
    ],
    guests: [
      { id: "g1", name: "Test Guest One", relationship: "Friend", meal: "non_veg" },
    ],
    accommodation: "private",
    extraBed: false,
    checkIn: "2026-08-15",
    checkOut: "2026-08-16",
    donationAmount: "15000",
    collegeContribution: 500,
    photoFileName: "sample_photo.jpg",
    photoFileKey: "mock-photo-conf",
    photoFileType: "image/jpeg",
    photoFileSizeBytes: 88000,
    idFileName: "sample_id.pdf",
    idFileKey: "mock-id-conf",
    idFileType: "application/pdf",
    idFileSizeBytes: 198000,
  };

  return (
    <div className="-m-6">
      <Confirmation
        data={mockData}
        onReset={() => alert("Reset — would navigate back to registration")}
      />
    </div>
  );
}

function PhotoIdDemo() {
  const base = createInitialData();
  const [data, setData] = useState<WizardDraft>({
    ...base,
    fullName: "Test Attendee One",
    email: "attendee1@example.com",
    branch: "Computer Science & Engineering",
    whatsapp: "9876543210",
    city: "Bangalore",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    spouseName: "Test Spouse Two",
    spouseMeal: "veg",
    children: [
      { id: "c1", name: "Test Child One", age: 4, meal: "veg" },
      { id: "c2", name: "Test Child Two", age: 8, meal: "non_veg" },
    ],
    guests: [
      { id: "g1", name: "Test Guest One", relationship: "Friend", meal: "non_veg" },
    ],
    accommodation: "private",
    extraBed: false,
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    donationAmount: "15000",
    collegeContribution: 500,
    idFileName: "",
    photoFileName: "",
    photoFileKey: "mock-photo-5",
    photoFileType: "image/jpeg",
    photoFileSizeBytes: 72000,
  });

  return (
    <div>
      <section className="mb-6 space-y-2">
        <p className="text-sm text-muted">
          Full Photo &amp; ID. Resize below 768px to see mobile
          layout with StickyBottomBar.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                participationType: "full_celebration",
                attendanceIntent: "attending",
                children: [
                  { id: "c1", name: "Test Child One", age: 4, meal: "veg" },
                  { id: "c2", name: "Test Child Two", age: 8, meal: "non_veg" },
                ],
                guests: [
                  { id: "g1", name: "Test Guest One", relationship: "Friend", meal: "non_veg" },
                ],
              }))
            }
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              data.participationType === "full_celebration"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Full Celebration + Family
          </button>
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                participationType: "donation_only" as const,
                attendanceIntent: "donation_only" as const,
              }))
            }
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
              data.participationType === "donation_only"
                ? "bg-terracotta text-white"
                : "bg-white text-muted border border-border hover:border-terracotta",
            ].join(" ")}
          >
            Donation Only
          </button>
          <button
            type="button"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                idFileKey: prev.idFileKey ? undefined : "mock-file-key-001",
                idFileType: prev.idFileKey ? undefined : "application/pdf",
                idFileSizeBytes: prev.idFileKey ? undefined : 123456,
                idFileName: prev.idFileKey ? "" : "sample_id.pdf",
              }))
            }
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-white text-muted border border-border hover:border-terracotta transition-colors"
          >
            Toggle ID Upload
          </button>
        </div>
      </section>
      <div className="border border-border-warm rounded-xl overflow-hidden">
        <PhotoId
          data={data}
          update={(changes) => setData((prev) => ({ ...prev, ...changes }))}
          onNext={() => alert("Payment successful — navigating to confirmation")}
          onBack={() => alert("Back clicked")}
          goToStep={(step) => alert(`Navigate to step ${step}`)}
        />
      </div>
    </div>
  );
}

// ── GoalCard demo ─────────────────────────────────────────────────────────────

function GoalCardDemo() {
  return (
    <div className="space-y-6 max-w-sm">
      {/* Normal state — 87 confirmed, 31 pending, 0 pendingVerification vs 200 */}
      <section>
        <h3 className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">
          Normal — 87 / 31 / 0 vs 200
        </h3>
        <GoalCard
          title="Full Celebration"
          target={200}
          confirmed={87}
          pending={31}
          pendingVerification={0}
          footnote="Pending holds a slot toward the goal"
        />
      </section>

      {/* Near-cap state — 38 confirmed, 7 pending, 2 pendingVerification vs 50 */}
      <section>
        <h3 className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">
          Near-cap — 38 / 7 / 2 vs 50
        </h3>
        <GoalCard
          title="Campus Only"
          target={50}
          confirmed={38}
          pending={7}
          pendingVerification={2}
          slotsNote="3 slots left — pending registrations hold a slot"
        />
      </section>

      {/* Over-cap state — 40 confirmed, 9 pending, 3 pendingVerification vs 50 → counted=52 */}
      <section>
        <h3 className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">
          Over-cap — 40 / 9 / 3 vs 50 (counted=52, +2)
        </h3>
        <GoalCard
          title="Campus Only"
          target={50}
          confirmed={40}
          pending={9}
          pendingVerification={3}
          slotsNote="This note should be hidden when over-cap"
        />
      </section>

      {/* Zero state — 0/0/0 vs 200 */}
      <section>
        <h3 className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">
          Zero-state — 0 / 0 / 0 vs 200
        </h3>
        <GoalCard
          title="Full Celebration"
          target={200}
          confirmed={0}
          pending={0}
          pendingVerification={0}
        />
      </section>
    </div>
  );
}

const HARDCODED_TEAMS = [
  "England",
  "Scotland",
  "Wales",
  "Northern Ireland",
];

const SUBSET = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Cameroon",
  "Canada", "Chile", "China", "Colombia", "Costa Rica", "Croatia",
  "Czech Republic", "Denmark", "Ecuador", "Egypt", "England",
  "France", "Germany", "Ghana", "Greece", "Hungary", "Iceland",
  "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait",
  "Mexico", "Morocco", "Netherlands", "New Zealand", "Nigeria",
  "Northern Ireland", "Norway", "Oman", "Panama", "Paraguay",
  "Peru", "Poland", "Portugal", "Qatar", "Romania", "Russia",
  "Saudi Arabia", "Scotland", "Senegal", "Serbia", "Slovakia",
  "Slovenia", "South Africa", "South Korea", "Spain", "Sweden",
  "Switzerland", "Turkey", "Ukraine", "United Arab Emirates",
  "United States", "Uruguay", "USA", "Venezuela", "Wales",
  "Zambia", "Zimbabwe",
];

function FlagsDebug() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"subset" | "all">("subset");

  const teamNames = scope === "all"
    ? [...Object.values(countries).map((c) => c.name), ...HARDCODED_TEAMS]
    : SUBSET;

  const filtered = query
    ? teamNames.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : teamNames;

  const results = filtered.map((name) => ({
    name,
    emoji: getTeamFlagEmoji(name),
    code: getTeamFlagCode(name),
  }));

  const ok = results.filter((r) => r.emoji);
  const missing = results.filter((r) => !r.emoji);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <Input
          placeholder="Search team name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1 bg-page rounded-lg p-0.5 border border-border">
          <button
            type="button"
            onClick={() => setScope("subset")}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              scope === "subset"
                ? "bg-terracotta text-white"
                : "text-muted hover:text-charcoal"
            }`}
          >
            Subset
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              scope === "all"
                ? "bg-terracotta text-white"
                : "text-muted hover:text-charcoal"
            }`}
          >
            All countries
          </button>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-700 mb-2">
            Missing flags ({missing.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {missing.map((r) => (
              <span
                key={r.name}
                className="px-2 py-1 rounded bg-white border border-red-200 text-xs text-red-600 font-mono"
              >
                {r.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {results.map((r) => (
          <div
            key={r.name}
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              r.emoji
                ? "bg-white border-border"
                : "bg-red-50 border-red-200"
            }`}
          >
            <span className="font-flag text-2xl leading-none w-8 text-center">
              {r.emoji ?? "—"}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-charcoal truncate">
                {r.name}
              </p>
              <p className="text-[10px] font-mono text-subtle">
                {r.code ?? "—"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {!query && (
        <p className="text-xs text-subtle text-center">
          {ok.length} / {results.length} flags resolved
        </p>
      )}
    </div>
  );
}

function CreditsReelDemo() {
  return (
    <div className="px-4 md:px-8 pb-10 space-y-4">
      <p className="text-sm text-muted">
        End-credits crawl for the Prediction Contest winners page. Press and
        hold to pause. Each name unmasks its background as it crosses the
        midline — scroll position is the clock, so pausing freezes the reveal.
        Test at 375px / 768px / 1280px.
      </p>
      <div className="rounded-2xl overflow-hidden border border-border-warm h-[82svh] min-h-[520px]">
        <CreditsReel />
      </div>
    </div>
  );
}

// ── SiteNav-vs-SlideOver reachability repro ─────────────────────────────────
//
// Reproduces the real StaffLayout stacking — <SiteNav/> (sticky, z-[300], its
// mobile dropdown portaled to document.body at z-[299]) as a sibling BEFORE
// the page content, with a full-screen SlideOver (fixed inset-0, z-40)
// mounted as a descendant of that content — to inspect real browser stacking
// and click-through at 375px without a live backend.
//
// NOTE: renders SiteNav in its PUBLIC-mode branch (no faked staff session —
// a real one needs a signed JWT from the actual magic-link flow, impractical
// here). The hamburger + portal-dropdown + z-index scheme
// (sticky/z-[300] nav, fixed/z-[299] portal, SlideOver's fixed/z-40) is
// IDENTICAL markup between SiteNav's isStaffMode and public branches
// (SiteNav.tsx:150-248 vs :301-393) — only which links populate the dropdown
// differs. That's enough to test the actual structural question (is the nav
// reachable over the overlay), which doesn't depend on which links render.
function DeskNavReproDemo() {
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [portaled, setPortaled] = useState(true);

  // NOTE: renders SiteNav in its PUBLIC-mode branch — a real staff session
  // needs a signed JWT from the actual magic-link flow (impractical here:
  // the local dev backend at :8787 validates and rejects a forged token,
  // clearing localStorage auth via its on-401 handler). Nesting a second
  // Router (MemoryRouter) to force isStaffMode, or using <Routes
  // location={…}> to override useLocation() for just this subtree, both hit
  // React Router constraints when nested this way. Verified by direct source
  // read instead (SiteNav.tsx): the isStaffMode branch's nav bar and mobile
  // dropdown use byte-identical sticky/z-[300] and fixed/z-[299] classes to
  // the public branch tested below — so this reproduces the same stacking
  // mechanics. The one difference relevant to the SlideOver-collision fix
  // (see SlideOver.tsx) is the logo: public mode uses a deliberately
  // oversized 78px "sticker" logo with translateY(26px) and
  // overflow-visible that pokes below the 52px nav bar (visible in this
  // repro); staff mode uses a plain 36px logo with no such overflow, so it
  // stays fully inside the 52px bar — confirmed by reading SiteNav.tsx's
  // isStaffMode branch, not reproduced live here.
  const repro = (
    <div className="bg-page min-h-screen">
      <SiteNav />
      <div className="max-w-[1320px] w-full mx-auto px-5 py-6">
        <p className="font-heading text-xl text-charcoal">Mock page content behind the overlay</p>
        <p className="text-sm text-muted mt-1">
          Stands in for RegistrationDeskPage&apos;s search results.
        </p>
      </div>
      {overlayOpen && (
        <SlideOver
          onClose={() => setOverlayOpen(false)}
          ariaLabel="Attendee record"
          labelledById="desk-nav-repro-name"
          panelTestId="desk-nav-repro-panel"
        >
          <nav className="sticky top-0 z-20 flex min-h-[56px] items-center justify-between border-b border-border-warm bg-surface/95 px-3 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setOverlayOpen(false)}
              className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-charcoal hover:bg-terracotta-light hover:text-terracotta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2"
            >
              ← Back
            </button>
            <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.12em] text-charcoal/80">
              Attendee record
            </span>
          </nav>
          <div className="p-5">
            <h2 id="desk-nav-repro-name" className="font-heading text-2xl font-bold text-charcoal">
              Test Attendee One
            </h2>
            <p className="text-sm text-muted mt-2">
              Mock detail content filling the slide-over panel — real
              DeskLedgerDetail content isn&apos;t needed to test nav
              reachability, only the SlideOver shell it&apos;s rendered inside.
            </p>
          </div>
        </SlideOver>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Reproduces the SiteNav-over-SlideOver stacking used at
        /staff/check-in/registration/:regCode, using the real SiteNav and
        SlideOver components (not a bespoke mock). Resize the actual browser
        window to 375px. &quot;Portal to page root&quot; moves the repro out from
        under this DebugPage&apos;s own header/tab-bar chrome (via createPortal to
        document.body) so SiteNav sits at y=0 exactly like StaffLayout does in
        production — otherwise this card&apos;s own preceding content pushes
        SiteNav below the fold, which understates whether it visually
        overlaps the SlideOver&apos;s own internal top bar (also pinned at y=0).
      </p>
      <div className="flex gap-3 flex-wrap">
        <Button size="sm" variant="secondary" type="button" onClick={() => setOverlayOpen((v) => !v)}>
          {overlayOpen ? "Close overlay" : "Open overlay"}
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => setPortaled((v) => !v)}>
          {portaled ? "Un-portal (inline)" : "Portal to page root (y=0, like production)"}
        </Button>
      </div>
      {portaled ? (
        <>
          <p className="text-xs text-subtle">Portaled to document.body — scroll the real page to see it; it covers the viewport.</p>
          {createPortal(<div className="fixed inset-0 z-[500] overflow-y-auto">{repro}</div>, document.body)}
        </>
      ) : (
        <div className="rounded-xl border border-border-warm overflow-visible">{repro}</div>
      )}
    </div>
  );
}

// ── Welcome Ribbon landing (registration desk) ──────────────────────────────
//
// Mirrors RegistrationDeskPage's landing structure exactly: the watercolour
// courtyard-arch backdrop (<picture> .webp, wide >=768px / vertical below) shown
// full and uncropped, a localized cream glow behind the heading, then DeskArch +
// DeskSearchPanel with a mocked, no-auth search. Inspect at 375px (vertical
// image) and 1280px (wide image).
function DeskRibbonDemo() {
  const [query, setQuery] = useState("");
  const [searchFired, setSearchFired] = useState<string | null>(null);

  // Sample rows so the stamp is visible (one row present → stamp shows, one
  // absent → clean baseline for comparison). The CSS vars from the studio
  // panel cascade down to every present row.
  const sampleRows: Array<{ present: true; name: string } | { present: false; name: string }> = [
    { present: true, name: "Sample Person A" },
    { present: true, name: "Sample Person B" },
    { present: false, name: "Sample Person C" },
  ];

  return (
    <div>
      <div className="relative mx-auto max-w-[1120px]">
        <div
          aria-hidden="true"
          className="desk-art-fade pointer-events-none absolute -left-5 -right-5 -top-6 aspect-[1086/1448] overflow-hidden md:aspect-[1642/958]"
        >
          <picture>
            <source media="(min-width: 768px)" srcSet="/assets/desk/welcome-ribbon-desktop.webp" />
            <img
              src="/assets/desk/welcome-ribbon-mobile.webp"
              alt=""
              className="h-full w-full object-cover object-top"
            />
          </picture>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(ellipse_62%_100%_at_50%_28%,color-mix(in_srgb,var(--color-surface)_82%,transparent),transparent_72%)]"
        />
        <div className="relative mx-auto max-w-[600px]">
          <DeskArch />
          <DeskSearchPanel
            query={query}
            onQueryChange={setQuery}
            onSubmit={(value) => setSearchFired(`${value} · ${new Date().toLocaleTimeString()}`)}
            loading={false}
            error={null}
            results={null}
            thumbsBaseUrl=""
            photosVersion={0}
            onSelectResult={() => {}}
          />
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[820px] text-xs text-muted">
        Welcome Ribbon landing — DeskArch + DeskSearchPanel over the arch
        backdrop, mocked search. Resize to 375px (vertical art) and 1280px
        (wide art). Type 2+ chars or press Enter.
        {searchFired && <> Last search fired: <span className="font-mono">{searchFired}</span></>}
      </p>

      {/* Search-list rows — DeskResultCard stamps its own button with
          desk-photo-stamp--list, so the picked CSS-var defaults (size 15%,
          x -25%, y -33%, rotate -20deg, opacity 0.7) cascade to the stamp. */}
      <div className="mt-8">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
          Search-list rows — present ones get the stamp
        </p>
        <div className="rounded-xl border border-border-warm bg-surface p-3">
          {sampleRows.map((row, i) => {
            const result: DeskSearchResult = {
              id: 900 + i,
              fullName: row.name,
              branch: "Electronics & Communication",
              regCode: "SMRT79WW4A25NWG1",
              participationType: "full_celebration",
              hasPhoto: false,
              checkIn: row.present
                ? { present: true, checkedInAt: 1_786_000_000_000 }
                : { present: false, checkedInAt: null },
            };
            return <DeskResultCard key={result.id} result={result} thumbsBaseUrl="" photosVersion={1} onSelect={() => {}} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ── Desk check-in celebration ───────────────────────────────────────────────
//
// Previews the "Confirm attendance" success moment on DeskLedgerDetail without a
// backend. "Confirm attendance" flips the attendee to present with celebrate=on
// (badge pop + confetti + welcome-back line); "Reopen (already present)" shows
// the calm, non-celebratory present state; "Reset" returns to not-present.
const DESK_CHECKIN_MOCK: DeskAttendeeOverview = {
  id: 4242,
  fullName: "Test Attendee Five",
  regCode: "SMRT79WW4A25NWG1",
  branch: "Electronics & Communication",
  participationType: "full_celebration",
  photo: { available: false, url: null },
  whatsapp: "+919876500000",
  mealPreference: "veg",
  accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16" },
  rooms: ["21"],
  additionalAttendees: { spouse: [], children: [], guests: [] },
  payment: { state: "confirmed" },
  checkIn: { present: false, checkedInAt: null },
  tshirts: [{ size: "M", gender: "female", isIncluded: true }],
};

// Only the chosen stamp ships in public/assets/desk (bundle size). The other
// eight originals live in tmp/2026-08-10-attendance-stamps/ — to try them again,
// re-convert one into public/ and add it here.
const STAMP_ASSETS = ["/assets/desk/attendance-stamp-01.webp"];

// Ink swatches to try. Change background-color only to recolour a mask.
const INK_SWATCHES: { label: string; value: string }[] = [
  { label: "Charcoal", value: "#1F2A33" },
  { label: "Terracotta", value: "#D76B51" },
  { label: "Success", value: "#2D9B67" },
  { label: "Navy", value: "#22304A" },
  { label: "Soft aqua", value: "#B9DFE2" },
  { label: "White", value: "#FFFFFF" },
];

// Shipped defaults for the DeskPhotoStamp CSS-var geometry — must mirror the
// `var(--stamp-*, …)` fallbacks in index.css so the panel opens where the stamp
// actually sits, and "Reset" returns to the real look.
const STAMP_DEFAULTS = { w: 58, x: 22, y: 6, rot: -12, opacity: 0.82, src: STAMP_ASSETS[0], ink: "#1dbf73" };

// A stand-in face so placement/coverage can be judged over a real photo, not
// only the initial-letter fallback tile. Any bundled image works here.
const DESK_STAMP_SAMPLE_PHOTO = "/assets/home-memory-corridor.jpg";

interface StampGeom {
  w: number;
  x: number;
  y: number;
  rot: number;
  opacity: number;
  src: string;
  ink: string;
}

function stampVars(g: StampGeom): CSSProperties {
  return {
    "--stamp-w": `${g.w}%`,
    "--stamp-x": `${g.x}%`,
    "--stamp-y": `${g.y}%`,
    "--stamp-rotate": `${g.rot}deg`,
    "--stamp-opacity": String(g.opacity),
    "--stamp-src": `url("${g.src}")`,
    "--stamp-ink": g.ink,
  } as CSSProperties;
}

/** Mask a swatch/chip with a stamp so the picker previews the actual shape. */
function maskChipStyle(src: string, ink: string): CSSProperties {
  return {
    backgroundColor: ink,
    WebkitMaskImage: `url("${src}")`,
    maskImage: `url("${src}")`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  } as CSSProperties;
}

/** One labelled slider + fine number input, wired to a StampGeom key. */
function StampSlider({
  label,
  suffix,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
        <span className="font-mono text-[11px] font-bold text-charcoal">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-terracotta"
      />
    </label>
  );
}

function DeskCheckinDemo() {
  const [present, setPresent] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [mode, setMode] = useState<"fast" | "slow" | "fail">("fast");
  const [checkInError, setCheckInError] = useState<string | null>(null);

  // Live stamp-geometry tuning (see floating panel). Fed to the wrapper as CSS
  // vars, which cascade into DeskPhotoStamp — no production props involved.
  const [geom, setGeom] = useState<StampGeom>({ ...STAMP_DEFAULTS });
  const [showPhoto, setShowPhoto] = useState(true);
  const [copied, setCopied] = useState(false);

  const setG = (patch: Partial<StampGeom>) => setGeom((g) => ({ ...g, ...patch }));

  const attendee: DeskAttendeeOverview = {
    ...DESK_CHECKIN_MOCK,
    checkIn: present ? { present: true, checkedInAt: 1_786_000_000_000 } : { present: false, checkedInAt: null },
  };

  async function onMarkPresent() {
    setCheckInError(null);
    await new Promise((resolve) => setTimeout(resolve, mode === "slow" ? 2200 : 800));
    if (mode === "fail") {
      setCheckInError("Mock failure — the button returns to idle.");
      throw new Error("mock failure");
    }
    setPresent(true);
    setCelebrate(true);
  }

  async function onMarkAbsent() {
    setCheckInError(null);
    setUndoing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setPresent(false);
      setCelebrate(false);
    } finally {
      setUndoing(false);
    }
  }

  function pick(next: "fast" | "slow" | "fail") {
    setMode(next);
    setPresent(false);
    setCelebrate(false);
    setCheckInError(null);
    setReplayKey((k) => k + 1);
  }
  function reopen() {
    setPresent(true);
    setCelebrate(false);
    setCheckInError(null);
    setReplayKey((k) => k + 1);
  }

  async function copyGeom() {
    const text = [
      "attendance stamp",
      `  stamp:   ${geom.src.split("/").pop()}`,
      `  ink:     ${geom.ink}`,
      `  width:   ${geom.w}%`,
      `  offsetX: ${geom.x}%`,
      `  offsetY: ${geom.y}%`,
      `  rotate:  ${geom.rot}deg`,
      `  opacity: ${geom.opacity}`,
      "",
      "index.css .desk-photo-stamp fallbacks:",
      `  --stamp-src: url("${geom.src}")`,
      `  --stamp-ink: ${geom.ink}`,
      `  --stamp-w: ${geom.w}%`,
      `  --stamp-x: ${geom.x}%`,
      `  --stamp-y: ${geom.y}%`,
      `  --stamp-rotate: ${geom.rot}deg`,
      `  --stamp-opacity: ${geom.opacity}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px]" style={stampVars(geom)}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant={mode === "fast" ? "primary" : "secondary"} onClick={() => pick("fast")}>Fast (0.8s)</Button>
        <Button type="button" variant={mode === "slow" ? "primary" : "secondary"} onClick={() => pick("slow")}>Slow (2.2s)</Button>
        <Button type="button" variant={mode === "fail" ? "primary" : "secondary"} onClick={() => pick("fail")}>Fails</Button>
        <Button type="button" variant="ghost" onClick={reopen}>Reopen (already present)</Button>
      </div>
      <div className="relative flex min-h-[520px] flex-col border border-border-warm bg-page">
        <DeskLedgerDetail
          key={replayKey}
          attendee={attendee}
          photoUrl={showPhoto ? DESK_STAMP_SAMPLE_PHOTO : null}
          checkInError={checkInError}
          onMarkPresent={onMarkPresent}
          onMarkAbsent={onMarkAbsent}
          undoing={undoing}
          celebrate={celebrate}
          // Not exercised by this preview — DESK_CHECKIN_MOCK is always
          // payment.state "confirmed", so the collect/charge footer branches
          // never render here.
          onCollectPayment={async () => {}}
          onAddCharge={async () => {}}
          chargeResult={null}
        />
      </div>
      <p className="mt-3 text-xs text-muted">
        Pick a mode, then click the terracotta <span className="font-mono">Confirm attendance</span> button inside the
        panel — the stamp presses onto the photo as the button turns green. "Reopen" shows the static stamp (already
        present). The stamp art is a recolourable CSS mask — the floating panel picks the stamp (1–9), the ink colour,
        and placement (Size + Nudge X/Y can push it across just the photo or over the name/pills). Hit
        <span className="font-mono">Copy</span> to grab the stamp + colour + numbers. Plays regardless of OS reduce-motion.
      </p>

      {/* Search-list stamp: present rows get a centred static stamp (its own
          .desk-photo-stamp--list geometry), not-present rows stay clean. */}
      <div className="mt-5 rounded-xl border border-border-warm bg-surface p-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Search-list rows</p>
        {(
          [
            { present: true, name: "Sample Person A" },
            { present: false, name: "Sample Person C" },
          ] as const
        ).map((row, i) => {
          const result: DeskSearchResult = {
            id: 900 + i,
            fullName: row.name,
            branch: "Electronics & Communication",
            regCode: "SMRT79WW4A25NWG1",
            participationType: "full_celebration",
            hasPhoto: false,
            checkIn: row.present ? { present: true, checkedInAt: 1_786_000_000_000 } : { present: false, checkedInAt: null },
          };
          return <DeskResultCard key={result.id} result={result} thumbsBaseUrl="" photosVersion={1} onSelect={() => {}} />;
        })}
      </div>

      {/* Floating stamp tuning panel — dev only, lives in DebugPage. */}
      <aside className="fixed bottom-4 right-4 z-50 max-h-[92vh] w-[268px] overflow-y-auto rounded-xl border border-border-warm bg-surface/98 p-3.5 shadow-[0_16px_40px_rgba(60,40,20,0.22)] backdrop-blur-md">
        <div className="mb-2.5 flex items-center justify-between">
          <strong className="font-heading text-sm text-charcoal">Stamp studio</strong>
          <button
            type="button"
            onClick={() => setGeom({ ...STAMP_DEFAULTS })}
            className="rounded-md px-2 py-1 text-[11px] font-bold text-muted hover:bg-terracotta-light hover:text-terracotta"
          >
            Reset
          </button>
        </div>

        {/* Stamp picker — each chip is the actual mask, so shape previews live. */}
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Stamp</span>
        <div className="mb-3 grid grid-cols-5 gap-1.5">
          {STAMP_ASSETS.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setG({ src })}
              title={`stamp-0${i + 1}`}
              className={`grid aspect-square place-items-center rounded-md border ${geom.src === src ? "border-terracotta ring-2 ring-terracotta/40" : "border-border-warm"} bg-page`}
            >
              <span className="h-6 w-6" style={maskChipStyle(src, geom.ink)} />
            </button>
          ))}
        </div>

        {/* Ink — swatches + arbitrary picker. Recolour = background-color only. */}
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Ink colour</span>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {INK_SWATCHES.map((sw) => (
            <button
              key={sw.value}
              type="button"
              onClick={() => setG({ ink: sw.value })}
              title={sw.label}
              style={{ backgroundColor: sw.value }}
              className={`h-6 w-6 rounded-full border ${geom.ink.toUpperCase() === sw.value.toUpperCase() ? "ring-2 ring-terracotta ring-offset-1" : "border-border-warm"}`}
            />
          ))}
          <label className="ml-auto flex items-center gap-1 text-[11px] font-bold text-muted">
            <input type="color" value={geom.ink} onChange={(e) => setG({ ink: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-border-warm bg-transparent p-0" />
          </label>
        </div>

        <div className="space-y-2.5">
          <StampSlider label="Size" suffix="%" min={20} max={160} step={1} value={geom.w} onChange={(w) => setG({ w })} />
          <StampSlider label="Nudge X" suffix="%" min={-120} max={120} step={1} value={geom.x} onChange={(x) => setG({ x })} />
          <StampSlider label="Nudge Y" suffix="%" min={-120} max={120} step={1} value={geom.y} onChange={(y) => setG({ y })} />
          <StampSlider label="Rotate" suffix="°" min={-45} max={45} step={1} value={geom.rot} onChange={(rot) => setG({ rot })} />
          <StampSlider label="Opacity" suffix="" min={0.2} max={1} step={0.01} value={geom.opacity} onChange={(opacity) => setG({ opacity })} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={copyGeom}
            className="flex-1 rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white hover:bg-terracotta-deep"
          >
            {copied ? "Copied ✓" : "Copy values"}
          </button>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
            <input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} className="accent-terracotta" />
            Photo
          </label>
        </div>
      </aside>
    </div>
  );
}

const WIZARD_LAYOUT_TABS: ComponentTab[] = [
  "participation",
  "alumni-details",
  "attendees-meals",
  "accommodation",
  "giving-back",
  "photo-id",
  "review-pay",
  "confirmation",
  "credits",
];

export default function DebugPage() {
  useDocumentTitle("Debug");
  const rawTab = new URLSearchParams(window.location.search).get("tab") ?? "button";
  const resolvedTab = (TAB_ALIASES[rawTab] ?? rawTab) as ComponentTab;
  const [tab, setTab] = useState<ComponentTab>(
    TABS.some((t) => t.key === resolvedTab) ? resolvedTab : "button",
  );
  const wizardLayout = WIZARD_LAYOUT_TABS.includes(tab);

  return (
    <div className="min-h-screen bg-page">
      <header className="bg-charcoal text-white p-4">
        <h1 className="font-heading text-2xl font-bold">
          Smriti Component Debug
        </h1>
        <p className="text-subtle text-sm mt-1 font-body">
          Isolated component testing — build &amp; verify one at a time
        </p>
      </header>

      <nav className="flex gap-1 p-3 bg-surface border-b border-border-warm overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold font-body whitespace-nowrap transition-colors ${
              tab === key
                ? "bg-terracotta text-white"
                : "text-muted hover:bg-soft-aqua-light"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className={wizardLayout ? "" : "max-w-5xl mx-auto p-6"}>
        {wizardLayout ? (
          <>
            <h2 className="font-heading text-xl font-bold text-charcoal px-8 pt-6 pb-2">
              {TABS.find((t) => t.key === tab)?.label}
            </h2>
            {tab === "participation" && <ParticipationDemo />}
            {tab === "alumni-details" && <AlumniDetailsDemo />}
            {tab === "attendees-meals" && <AttendeesMealsDemo />}
            {tab === "accommodation" && <AccommodationDemo />}
            {tab === "giving-back" && <GivingBackDemo />}
            {tab === "photo-id" && <PhotoIdDemo />}
            {tab === "review-pay" && <ReviewPayDemo />}
            {tab === "confirmation" && <ConfirmationDemo />}
            {tab === "credits" && <CreditsReelDemo />}
          </>
        ) : (
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-charcoal mb-4">
            {TABS.find((t) => t.key === tab)?.label}
          </h2>
          {tab === "button" && <ButtonDemo />}
          {tab === "input" && <InputDemo />}
          {tab === "textarea" && <TextareaDemo />}
          {tab === "select" && <SelectDemo />}
          {tab === "toggle" && <ToggleDemo />}
          {tab === "mealtoggle" && <MealToggleDemo />}
          {tab === "formfield" && <FormFieldDemo />}
          {tab === "stepper" && <StepperDemo />}
          {tab === "fileupload" && <FileUploadDemo />}
          {tab === "card" && <CardDemo />}
          {tab === "badge" && <BadgeDemo />}
          {tab === "estimatesidebar" && <EstimateSidebarDemo />}
          {tab === "hero" && <HeroDemo />}
          {tab === "gpay-overlay" && <GPayOverlayDemo />}
          {tab === "goal-card" && <GoalCardDemo />}
          {tab === "flags" && <FlagsDebug />}
          {tab === "desk-nav-repro" && <DeskNavReproDemo />}
          {tab === "desk-ribbon" && <DeskRibbonDemo />}
          {tab === "desk-checkin" && <DeskCheckinDemo />}
          {tab !== "button" &&
            tab !== "input" &&
            tab !== "textarea" &&
            tab !== "select" &&
            tab !== "toggle" &&
            tab !== "mealtoggle" &&
            tab !== "formfield" &&
            tab !== "stepper" &&
            tab !== "fileupload" &&
            tab !== "card" &&
            tab !== "badge" &&
            tab !== "estimatesidebar" &&
            tab !== "hero" &&
            tab !== "gpay-overlay" &&
            tab !== "goal-card" &&
            tab !== "flags" &&
            tab !== "desk-nav-repro" &&
            tab !== "desk-ribbon" && (
              <div className="p-4 border border-dashed border-border rounded-lg min-h-[200px] flex items-center justify-center text-muted">
                Component not built yet
              </div>
            )}
        </section>
        )}
      </main>
    </div>
  );
}
