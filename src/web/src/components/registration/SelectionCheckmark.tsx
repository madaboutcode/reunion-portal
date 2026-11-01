import { ParticipationIcon } from "@/components/registration/ParticipationIcons";

export function SelectionCheckmark() {
  return (
    <span
      className={[
        "absolute -top-2.5 -right-2.5 z-20",
        "w-8 h-8 rounded-full bg-terracotta",
        "flex items-center justify-center",
        "shadow-[0_2px_8px_rgba(215,107,81,0.45)]",
        "text-white",
      ].join(" ")}
      aria-hidden
    >
      <ParticipationIcon name="check" size={16} className="text-white" />
    </span>
  );
}