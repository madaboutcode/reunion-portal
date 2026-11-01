import { useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { PolaroidPoolContext } from "@/context/polaroid-pool-context";
import {
  POLAROID_MANIFEST,
  preloadPolaroidSheets,
} from "@/lib/polaroid-sprites";
import { PolaroidPool } from "@/lib/polaroid-pool";

const pool = new PolaroidPool(POLAROID_MANIFEST);

export function PolaroidPoolProvider({ children }: { children: ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const indices = POLAROID_MANIFEST.sheets.map((s) => s.sheetIndex);
    void preloadPolaroidSheets(POLAROID_MANIFEST, indices);
  }, []);

  useEffect(() => {
    pool.resetScreen();
  }, [location.pathname, location.search]);

  const value = useMemo(
    () => ({
      pool,
      manifest: POLAROID_MANIFEST,
      sheets: pool.getSheets(),
      ready: true,
    }),
    [],
  );

  return (
    <PolaroidPoolContext.Provider value={value}>
      {children}
    </PolaroidPoolContext.Provider>
  );
}
