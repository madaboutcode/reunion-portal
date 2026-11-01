export interface AvatarProps {
  name: string;
  colorScheme?: "terracotta" | "cyan";
  size?: "sm" | "md";
}

export function Avatar({ name, colorScheme = "cyan", size = "md" }: AvatarProps) {
  const initials = (() => {
    if (!name.trim()) return "?";
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0][0].toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  })();

  const sizeClasses = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  const colorClasses =
    colorScheme === "terracotta" ? "bg-terracotta" : "bg-[#5BA3A8]";

  return (
    <div
      className={`${sizeClasses} ${colorClasses} rounded-full flex items-center justify-center font-bold text-white select-none`}
    >
      {initials}
    </div>
  );
}
