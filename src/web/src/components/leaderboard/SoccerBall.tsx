export function SoccerBall({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="16" cy="16" r="14.5" fill="#fff" stroke="#303030" strokeWidth="1" />
      <path d="M16 9 L21.7 13.2 L19.5 20 L12.5 20 L10.3 13.2 Z" fill="#1a1a1a" />
      <path
        d="M16 9 L16 2.5M21.7 13.2 L28 11M19.5 20 L24 25.5M12.5 20 L8 25.5M10.3 13.2 L4 11"
        stroke="#1a1a1a"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}