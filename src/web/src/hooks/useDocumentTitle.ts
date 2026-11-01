import { useEffect } from "react";

const SUFFIX = "Smriti 2026 — TKMCE 20-Year Reunion";
const DEFAULT_DESCRIPTION =
  "Smriti — 20-year reunion of TKMCE Batch of 2006. Campus corridors to global paths and back to TKMCE once again. Register for the celebration on August 15th, 2026.";

export function useDocumentTitle(page?: string, description?: string) {
  useEffect(() => {
    document.title = page ? `${page} - ${SUFFIX}` : SUFFIX;

    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", description ?? DEFAULT_DESCRIPTION);
    }
  }, [page, description]);
}
