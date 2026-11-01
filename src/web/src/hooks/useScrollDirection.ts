import { useState, useEffect, useRef } from "react";

const SCROLL_THRESHOLD = 60;

/** True when the user has scrolled down past the threshold (nav should hide). */
export function useScrollDirection(disabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) {
      setHidden(false);
      return;
    }

    function handleScroll() {
      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        if (currentScrollY < SCROLL_THRESHOLD) {
          setHidden(false);
        } else if (currentScrollY > lastScrollY.current) {
          setHidden(true);
        } else {
          setHidden(false);
        }
        lastScrollY.current = currentScrollY;
        rafId.current = null;
      });
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [disabled]);

  return hidden;
}