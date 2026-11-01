import { useCallback, useEffect, useRef, useState } from "react";
import { publicPhotoUrl } from "@/lib/api";
import type { WhosComingResponse } from "@/lib/prediction-types";

interface UseWhosComingAvatarsResult {
  getAvatarUrl: (emailHash: string) => string | null;
  loading: boolean;
}

export function useWhosComingAvatars(): UseWhosComingAvatarsResult {
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function fetchAvatars() {
      try {
        const res = await fetch("/api/public/whos-coming");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: WhosComingResponse = await res.json();

        const avatarMap = new Map<string, string>();
        for (const person of data.people) {
          if (person.hasPhoto && person.emailHash) {
            avatarMap.set(
              person.emailHash,
              publicPhotoUrl(person.id, data.thumbsBaseUrl, data.photosVersion),
            );
          }
        }

        if (!cancelled) {
          mapRef.current = avatarMap;
        }
      } catch {
        // Fetch failure → all lookups return null
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAvatars();
    return () => { cancelled = true; };
  }, []);

  const getAvatarUrl = useCallback(
    (emailHash: string): string | null => mapRef.current.get(emailHash) ?? null,
    [],
  );

  return { getAvatarUrl, loading };
}
