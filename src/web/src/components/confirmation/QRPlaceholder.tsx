// Deterministic pseudo-QR placeholder — looks like a QR code, not a real one.
// Seeded from `value` so the same ID always renders the same grid.

export interface QRPlaceholderProps {
  value: string;
  size?: number;
}

export function QRPlaceholder({ value, size = 180 }: QRPlaceholderProps) {
  const N = 25;
  let seed = 0;
  for (let i = 0; i < value.length; i++) {
    seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const cells: [number, number][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const inFinder =
        (x < 7 && y < 7) ||
        (x >= N - 7 && y < 7) ||
        (x < 7 && y >= N - 7);
      if (inFinder) continue;
      if (rand() > 0.52) cells.push([x, y]);
    }
  }

  const finder = (cx: number, cy: number) => (
    <g key={`f${cx}${cy}`}>
      <rect x={cx} y={cy} width={7} height={7} fill="#1F2A33" />
      <rect x={cx + 1} y={cy + 1} width={5} height={5} fill="white" />
      <rect x={cx + 2} y={cy + 2} width={3} height={3} fill="#1F2A33" />
    </g>
  );

  return (
    <svg
      viewBox={`0 0 ${N} ${N}`}
      width={size}
      height={size}
      className="block"
      style={{ shapeRendering: "crispEdges" }}
      aria-label="QR code"
    >
      <rect width={N} height={N} fill="white" />
      {finder(0, 0)}
      {finder(N - 7, 0)}
      {finder(0, N - 7)}
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill="#1F2A33" />
      ))}
    </svg>
  );
}
