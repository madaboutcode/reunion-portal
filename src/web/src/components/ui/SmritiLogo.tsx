import { useState } from "react";
import { Link } from "react-router-dom";

export interface SmritiLogoProps {
  size?: number;
  href?: string;
}

export function SmritiLogo({ size = 60, href }: SmritiLogoProps) {
  const [imgError, setImgError] = useState(false);

  const logo = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {imgError ? (
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: size * 0.42,
            fontWeight: 700,
            color: "#1F2A33",
            lineHeight: 1,
          }}
        >
          S
        </span>
      ) : (
        <img
          src="/assets/smriti-logo.png"
          alt="Smriti"
          width={size}
          height={size}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );

  if (href) {
    return <Link to={href} className="no-underline">{logo}</Link>;
  }

  return logo;
}
