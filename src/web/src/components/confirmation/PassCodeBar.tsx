interface PassCodeBarProps {
  code: string;
}

function QRIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
      <rect x="2" y="2" width="32" height="32" rx="4" stroke="#9CC9CE" strokeWidth="1.5"/>
      <rect x="6" y="6" width="10" height="10" rx="1" fill="#9CC9CE"/>
      <rect x="20" y="6" width="10" height="10" rx="1" fill="#9CC9CE"/>
      <rect x="6" y="20" width="10" height="10" rx="1" fill="#9CC9CE"/>
      <rect x="21" y="21" width="3" height="3" fill="#9CC9CE"/>
      <rect x="26" y="21" width="3" height="3" fill="#9CC9CE"/>
      <rect x="21" y="26" width="3" height="3" fill="#9CC9CE"/>
      <rect x="26" y="26" width="3" height="3" fill="#9CC9CE"/>
    </svg>
  );
}

export function PassCodeBar({ code }: PassCodeBarProps) {
  return (
    <div
      className="rounded-[14px] px-[18px] py-3 flex items-center justify-between gap-3"
      style={{
        background: "#1F2A33",
        border: "1px solid rgba(255,255,255,0.06)",
        containerType: "inline-size",
      }}
    >
      <div className="min-w-0">
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 2.5,
            color: "#9CC9CE",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          Pass Code
        </div>
        <div
          style={{
            fontFamily: "Menlo, Monaco, 'Courier New', monospace",
            fontSize: "clamp(14px, 5.5cqi, 26px)",
            fontWeight: 700,
            color: "#FBF6EC",
            letterSpacing: 2,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {code}
        </div>
      </div>
      <QRIcon />
    </div>
  );
}
