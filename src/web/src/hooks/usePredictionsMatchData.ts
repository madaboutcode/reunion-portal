import { useCallback, useEffect, useState } from "react";
import type {
  DatasourceResponse,
  FixtureRow,
  PlayerRow,
  PredictionRow,
  PredictionsDataset,
  ScoreRow,
} from "@/lib/prediction-types";

type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & PredictionsDataset);

async function fetchSheet<T>(sheet: string): Promise<T[]> {
  const response = await fetch(`/api/datasources/predictions/${sheet}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${sheet.toLowerCase()} (${response.status})`);
  }

  const payload = (await response.json()) as DatasourceResponse;
  return payload.data as unknown as T[];
}

export function usePredictionsMatchData() {
  const [state, setState] = useState<DataState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [fixtures, predictions, scores, players] = await Promise.all([
          fetchSheet<FixtureRow>("Fixtures"),
          fetchSheet<PredictionRow>("Predictions"),
          fetchSheet<ScoreRow>("Scores"),
          fetchSheet<PlayerRow>("Players"),
        ]);

        if (cancelled) return;

        setState({
          status: "ready",
          fixtures,
          predictions,
          scores,
          players,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load predictions replay",
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { state, retry };
}
