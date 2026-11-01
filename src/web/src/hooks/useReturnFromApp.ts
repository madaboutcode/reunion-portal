import { useEffect, useRef } from "react";

export function useReturnFromApp(onReturn: () => void): void {
  const departed = useRef(false);
  const callbackRef = useRef(onReturn);
  callbackRef.current = onReturn;

  useEffect(() => {
    function handleHidden() {
      if (document.visibilityState === "hidden") {
        departed.current = true;
      }
      if (document.visibilityState === "visible" && departed.current) {
        departed.current = false;
        callbackRef.current();
      }
    }

    function handleFocus() {
      if (departed.current) {
        departed.current = false;
        callbackRef.current();
      }
    }

    document.addEventListener("visibilitychange", handleHidden);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleHidden);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
}
