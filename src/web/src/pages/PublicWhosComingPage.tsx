import { useState, useEffect } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { WhosComingView } from "@/components/whos-coming/WhosComingView";
import { fetchWhosComingPublic, type PublicAttendee } from "@/lib/api";

export default function PublicWhosComingPage() {
  useDocumentTitle("Who's Coming");

  const [people, setPeople] = useState<PublicAttendee[]>([]);
  const [thumbsBaseUrl, setThumbsBaseUrl] = useState("");
  const [photosVersion, setPhotosVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWhosComingPublic();
        if (!cancelled) {
          setPeople(res.people);
          setThumbsBaseUrl(res.thumbsBaseUrl);
          setPhotosVersion(res.photosVersion);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load attendees");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <WhosComingView
      people={people}
      thumbsBaseUrl={thumbsBaseUrl}
      photosVersion={photosVersion}
      loading={loading}
      error={error}
    />
  );
}
