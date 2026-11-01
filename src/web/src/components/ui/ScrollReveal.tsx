import React from "react";
import { useInView } from "@/hooks/useInView";

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  /** IntersectionObserver threshold (0-1). Default 0.15 */
  threshold?: number;
  /** Animation delay in ms. Use for staggering items in a list */
  delay?: number;
}

export function ScrollReveal({
  children,
  className = "",
  threshold = 0.15,
  delay = 0,
}: ScrollRevealProps) {
  const { ref, visible } = useInView(threshold);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(24px)",
        transition: `opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

interface ScrollRevealGroupProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** IntersectionObserver threshold (0-1). Default 0.1 */
  threshold?: number;
  /** Ms between each child's animation start. Default 80 */
  stagger?: number;
  /** Base delay before first child in ms. Default 0 */
  baseDelay?: number;
  /**
   * slide — horizontal slide-in (default).
   * fade — opacity only; preserves child transforms (e.g. polaroid rotation).
   */
  motion?: "slide" | "fade";
  /** Applied to each child wrapper (e.g. `w-full min-w-0` for grid layouts). */
  itemClassName?: string;
}

export function ScrollRevealGroup({
  children,
  className = "",
  style,
  threshold = 0.1,
  stagger = 80,
  baseDelay = 0,
  motion = "slide",
  itemClassName = "",
}: ScrollRevealGroupProps) {
  const { ref, visible } = useInView(threshold);
  const items = React.Children.toArray(children);
  const easing = "cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div ref={ref} className={className} style={style}>
      {items.map((child, i) => {
        const delay = baseDelay + i * stagger;
        const hiddenTransform = motion === "fade" ? "scale(0.94)" : "translateX(24px)";
        const visibleTransform = motion === "fade" ? "scale(1)" : "translateX(0)";

        return (
          <div
            key={React.isValidElement(child) && child.key != null ? child.key : i}
            className={itemClassName}
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? visibleTransform : hiddenTransform,
              transition: `opacity 0.6s ${easing} ${delay}ms, transform 0.6s ${easing} ${delay}ms`,
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
