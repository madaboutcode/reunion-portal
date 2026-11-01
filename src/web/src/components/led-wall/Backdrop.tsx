import type { LayoutTree } from "./layout";

interface BackdropProps {
  layout: LayoutTree;
}

export function Backdrop({ layout }: BackdropProps) {
  const { backdrop, wall } = layout;
  return (
    <div className="led-wall-backdrop" aria-hidden="true">
      <img
        className="led-wall-backdrop__image"
        src="/assets/led-wall/campus-night.png"
        alt=""
        style={{
          opacity: backdrop.op,
          transform: `scale(${backdrop.zoom}) translate(${backdrop.x}%, ${backdrop.y}%)`,
          filter: `blur(${backdrop.blur}px)`,
          WebkitMaskImage: `radial-gradient(ellipse 50% 50% at 50% 50%, #000 ${backdrop.feather}%, rgba(0,0,0,.5) ${backdrop.feather2}%, transparent 100%)`,
          maskImage: `radial-gradient(ellipse 50% 50% at 50% 50%, #000 ${backdrop.feather}%, rgba(0,0,0,.5) ${backdrop.feather2}%, transparent 100%)`,
        }}
      />
      <div
        className="led-wall-backdrop__dim"
        style={{
          background: `linear-gradient(100deg, rgba(6,12,20,${backdrop.dimL}) 0%, rgba(6,12,20,${backdrop.dimM}) 34%, rgba(6,12,20,.10) 56%, rgba(6,12,20,${backdrop.dimR}) 100%)`,
        }}
      />
      <div
        className="led-wall-backdrop__vignette"
        style={{ background: `radial-gradient(120% 110% at 50% 50%, transparent 45%, rgba(4,8,14,${backdrop.vig}) 100%)` }}
      />
      <div className="led-wall-particles">
        {layout.decor.sparks.map((spark, index) => (
          <span
            key={`spark-${index}`}
            className="led-wall-spark"
            style={{
              left: `${spark.x}%`,
              top: `${spark.y}%`,
              width: `${spark.r}px`,
              height: `${spark.r}px`,
              background: spark.c,
              opacity: 0.16,
              animationDuration: `${spark.dur}s`,
              animationDelay: `${spark.d}s`,
            }}
          />
        ))}
        {layout.decor.embers.map((ember, index) => (
          <span
            key={`ember-${index}`}
            className="led-wall-ember"
            style={{
              left: `${ember.x}%`,
              bottom: `${ember.b}%`,
              width: `${ember.r}px`,
              height: `${ember.r}px`,
              animationDuration: `${ember.dur}s`,
              animationDelay: `${ember.d}s`,
            }}
          />
        ))}
      </div>
      {layout.decor.graphicOp > 0 && (
        <svg
          className="led-wall-doodle"
          viewBox={`0 0 ${wall.w} ${wall.h}`}
          role="presentation"
          style={{ opacity: layout.decor.graphicOp }}
        >
          <defs>
            <path
              id="spark"
              d="M0-30C2 -10 10 -2 30 0 10 2 2 10 0 30 -2 10 -10 2 -30 0 -10 -2 -2 -10 0-30Z"
            />
            <path
              id="spark-o"
              d="M0-26C1.6-9 8.6-1.6 26 0 8.6 1.6 1.6 8.6 0 26 -1.6 8.6 -8.6 1.6 -26 0 -8.6-1.6 -1.6-8.6 0-26Z"
              fill="none"
              stroke="#7fbfb8"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
            <marker
              id="tip"
              viewBox="0 0 12 12"
              refX="9"
              refY="6"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M1 1 11 6 1 11"
                fill="none"
                stroke="#e0674a"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>
          {layout.decor.sparkles.map((sparkle, index) => (
            <use
              key={`doodle-sparkle-${index}`}
              href={sparkle.href}
              transform={`translate(${sparkle.x} ${sparkle.y}) scale(${sparkle.s})`}
              fill={sparkle.fill}
              opacity={sparkle.op}
              style={{
                animation: `twinkle ${sparkle.dur}s ease-in-out infinite`,
                animationDelay: `${sparkle.delay}s`,
              }}
            />
          ))}
          {layout.decor.arrows.map((arrow, index) => (
            <path
              key={`doodle-arrow-${index}`}
              d={arrow.d}
              stroke="#e0674a"
              strokeWidth={arrow.w}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={arrow.dashes}
              markerEnd="url(#tip)"
              opacity={arrow.op}
              style={{ animation: `dash ${arrow.dur}s linear infinite` }}
            />
          ))}
          {layout.decor.rules.map((rule, index) => (
            <path
              key={`doodle-rule-${index}`}
              d={rule.d}
              stroke={rule.stroke}
              strokeWidth={rule.w}
              fill="none"
              strokeLinecap="round"
              opacity={rule.op}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
