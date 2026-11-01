interface NoteProps {
  children: React.ReactNode;
  variant?: "info" | "warning" | "error";
  className?: string;
}

const VARIANTS = {
  info: {
    container: "bg-[#FEF9E7] text-[#92400E]",
    icon: "ℹ",
    iconColor: "text-[#b45309]",
  },
  warning: {
    container: "bg-amber-50 border border-amber-200 text-amber-700",
    icon: "⚠",
    iconColor: "text-amber-500",
  },
  error: {
    container: "bg-red-50 border border-red-200 text-red-700",
    icon: "✕",
    iconColor: "text-red-400",
  },
};

export function Note({ children, variant = "info", className = "" }: NoteProps) {
  const v = VARIANTS[variant];
  return (
    <div className={`flex gap-2.5 px-3.5 py-2.5 rounded-lg ${v.container} ${className}`}>
      <span className={`text-[13px] leading-[1.5] shrink-0 ${v.iconColor}`} aria-hidden="true">
        {v.icon}
      </span>
      <div className="text-[13px] font-medium leading-[1.5]">
        {children}
      </div>
    </div>
  );
}
