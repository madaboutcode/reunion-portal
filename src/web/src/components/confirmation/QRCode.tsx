// QRCode component using the qrcode library to generate real SVG QR codes.
// Encodes a full URL for pass retrieval: {domain}/pass#{regCode}

import qrcode from "qrcode";
import { useLayoutEffect, useState } from "react";

export interface QRCodeProps {
  value: string;
  size?: number;
  foreground?: string;
  background?: string;
}

export function QRCode({
  value,
  size = 180,
  foreground = "#1F2A33",
  background = "#FFFFFF",
}: QRCodeProps) {
  const [svg, setSvg] = useState<string>("");

  useLayoutEffect(() => {
    const svgPromise = qrcode.toString(value, {
      type: "svg",
      width: size,
      margin: 0,
      color: {
        dark: foreground,
        light: background,
      },
    });
    svgPromise.then(setSvg).catch(() => {});
  }, [value, size, foreground, background]);

  if (!svg) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="QR code">
        <rect width={size} height={size} fill={background} />
        {/* Skeleton loading blocks */}
        <rect x={size * 0.1} y={size * 0.1} width={size * 0.15} height={size * 0.15} fill="#eee" />
        <rect x={size * 0.75} y={size * 0.1} width={size * 0.15} height={size * 0.15} fill="#eee" />
        <rect x={size * 0.1} y={size * 0.75} width={size * 0.15} height={size * 0.15} fill="#eee" />
        <rect x={size * 0.35} y={size * 0.35} width={size * 0.3} height={size * 0.3} fill="#eee" />
      </svg>
    );
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        width: size,
        height: size,
        overflow: "hidden",
      }}
      className="[&>svg]:w-full [&>svg]:h-full"
      aria-label="QR code for pass check-in"
    />
  );
}
