import { useEffect } from "react";
import { useToast } from "./Toast";
import { ApiError } from "@/lib/http";

export function GlobalErrorCatcher() {
  const toast = useToast();

  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const err = event.reason;

      if (err instanceof ApiError) {
        if (err.code === "NETWORK_ERROR") {
          toast.error("Network error — check your connection and try again.");
        } else {
          toast.error(err.code === "NO_TOKEN" ? "Session expired. Please refresh." : err.message || "Something went wrong.");
        }
      } else if (err instanceof Error) {
        toast.error(err.message || "Something went wrong.");
      } else {
        toast.error("Something went wrong.");
      }

      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, [toast]);

  return null;
}
