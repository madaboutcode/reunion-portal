import { useId, useState } from "react";
import type { ChartPoint } from "@/lib/prediction-types";

export interface PointsChartProps {
  data: ChartPoint[];
}

const NICE_INTERVALS = [10, 25, 50, 100, 200, 500];

const WIDTH = 800;
const HEIGHT = 200;
const PAD_TOP = 20;
const PAD_BOTTOM = 30;
const PAD_LEFT = 40;
const PAD_RIGHT = 20;

function pickInterval(maxValue: number): number {
  if (maxValue <= 0) return NICE_INTERVALS[0];
  for (const interval of NICE_INTERVALS) {
    if (Math.floor(maxValue / interval) <= 6) return interval;
  }
  return NICE_INTERVALS[NICE_INTERVALS.length - 1];
}

export function PointsChart({ data }: PointsChartProps) {
  const gradientId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const chartWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const chartHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const maxRunning = Math.max(...data.map((d) => d.running), 0);
  const interval = pickInterval(maxRunning);
  const gridMax = Math.max(interval, Math.ceil((maxRunning || 1) / interval) * interval);

  const xFor = (index: number): number =>
    data.length === 1
      ? PAD_LEFT + chartWidth / 2
      : PAD_LEFT + (index / (data.length - 1)) * chartWidth;

  const yFor = (value: number): number => PAD_TOP + chartHeight - (value / gridMax) * chartHeight;

  const points = data.map((d, i) => ({ x: xFor(i), y: yFor(d.running), point: d, index: i }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x} ${PAD_TOP + chartHeight} L ${points[0].x} ${PAD_TOP + chartHeight} Z`
      : "";

  const gridLines: number[] = [];
  for (let v = interval; v <= gridMax; v += interval) {
    gridLines.push(v);
  }

  const active = activeIndex !== null ? points[activeIndex] : null;

  return (
    <div className="w-full min-h-[160px]">
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        role="img"
        aria-label="Points progression chart"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D76B51" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#D76B51" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((value) => {
          const y = yFor(value);
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={WIDTH - PAD_RIGHT}
                y2={y}
                stroke="#1F2A33"
                strokeOpacity="0.1"
                strokeWidth="1"
              />
              <text x={PAD_LEFT - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#5B6670">
                {value}
              </text>
            </g>
          );
        })}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP + chartHeight}
          x2={WIDTH - PAD_RIGHT}
          y2={PAD_TOP + chartHeight}
          stroke="#1F2A33"
          strokeOpacity="0.2"
          strokeWidth="1"
        />
        <text
          x={PAD_LEFT - 8}
          y={PAD_TOP + chartHeight}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize="10"
          fill="#5B6670"
        >
          0
        </text>

        {points.length > 1 && <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />}

        {points.length > 1 ? (
          <path d={linePath} fill="none" stroke="#e8722a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ) : (
          <circle cx={points[0].x} cy={points[0].y} r="4" fill="#D76B51" />
        )}

        {points.map(
          (p) =>
            p.point.tier === "exact" && (
              <circle key={`dot-${p.point.matchId}`} cx={p.x} cy={p.y} r="4" fill="#D76B51" />
            ),
        )}

        {points.map((p) => (
          <rect
            key={`hit-${p.point.matchId}`}
            x={p.x - (chartWidth / Math.max(data.length, 1)) / 2}
            y={PAD_TOP}
            width={chartWidth / Math.max(data.length, 1)}
            height={chartHeight}
            fill="transparent"
            onMouseEnter={() => setActiveIndex(p.index)}
            onMouseLeave={() => setActiveIndex((current) => (current === p.index ? null : current))}
            onClick={() => setActiveIndex((current) => (current === p.index ? null : p.index))}
            className="cursor-pointer"
          />
        ))}

        {active && (
          <g transform={`translate(${Math.min(Math.max(active.x, PAD_LEFT + 55), WIDTH - PAD_RIGHT - 55)}, ${Math.max(active.y - 14, PAD_TOP + 40)})`}>
            <rect x="-55" y="-40" width="110" height="40" rx="6" fill="#1F2A33" />
            <text x="0" y="-26" textAnchor="middle" fontSize="9" fill="#B9DFE2">
              {active.point.matchLabel}
            </text>
            <text x="0" y="-14" textAnchor="middle" fontSize="10" fontWeight="600" fill="#ffffff">
              {`+${active.point.points} pts`}
            </text>
            <text x="0" y="-2" textAnchor="middle" fontSize="9" fill="#ffffff">
              {`Total: ${active.point.running}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
