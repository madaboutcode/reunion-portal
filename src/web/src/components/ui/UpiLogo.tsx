export function UpiLogo({ size = 24, className = "" }: { size?: number; className?: string }) {
  const h = size;
  const w = h * (849 / 224);

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 849 224"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="UPI"
      role="img"
    >
      {/* U */}
      <path d="M287,208.3a20.35,20.35,0,0,1-19.55,15H39.08A15.93,15.93,0,0,1,25.17,217a17.24,17.24,0,0,1-1.9-15.71L78.93.6h44.31L73.48,180H250.65L300.66.85h43.79Z" />
      {/* P */}
      <path d="M632,7A16.21,16.21,0,0,0,617.81.6H374.47l-12,43.55H583.85L571,90.65H349.47L312.76,223.3h44.31l24.6-89h199A28,28,0,0,0,598.25,128a29.48,29.48,0,0,0,10.8-15.75l24.61-89A17.92,17.92,0,0,0,632,7Z" />
      {/* I */}
      <path d="M655,222.19H610.7L672.26,0h44.31Z" />
      {/* Arrow (shadow) */}
      <path d="M793,.4l56,111.35L731.27,223.1Z" opacity="0.5" />
      {/* Arrow (front) */}
      <path d="M753.68,.4l56,111.35L691.87,223.1Z" />
    </svg>
  );
}
