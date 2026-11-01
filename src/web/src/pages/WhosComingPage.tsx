import { useState, useEffect } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { fetchRegistrations } from "@/lib/staff-api";
import { fetchWhosComingPublic, publicPhotoUrl } from "@/lib/api";
import type { StaffRegistrationListItem } from "@/lib/staff-types";
import { PolaroidCard, ShimmerCard } from "@/components/whos-coming/PolaroidCard";
import { BRANCH_COLORS, BRANCHES, type Branch } from "@smriti/shared";

function isBranch(value: string): value is Branch {
  return (BRANCHES as readonly string[]).includes(value);
}

// ── Constants ──────────────────────────────────────────────────────────────

type DatePreset = "today" | "week" | "month" | "all";
type ParticipationFilter = "all" | "full_celebration" | "campus_only" | "confirmed" | "pending";

interface DateRange {
  preset: DatePreset;
  start: string;
  end: string;
}

function getPresetRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === "today") {
    const s = toDateStr(now);
    return { start: s, end: s };
  }
  if (preset === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { start: toDateStr(start), end: toDateStr(now) };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toDateStr(start), end: toDateStr(now) };
  }
  return { start: "", end: "" };
}

const PARTICIPATION_PILLS: Array<{ key: ParticipationFilter; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "full_celebration", label: "Full Celebration" },
  { key: "campus_only", label: "Campus Only" },
  { key: "confirmed", label: "Confirmed" },
  { key: "pending", label: "Pending" },
];

const DATE_PRESETS: Array<{ key: DatePreset; label: string }> = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

// ── WhosComingPage ─────────────────────────────────────────────────────────

export function WhosComingPage() {
  useDocumentTitle("Who's Coming");

  const [allPeople, setAllPeople] = useState<StaffRegistrationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [thumbsBaseUrl, setThumbsBaseUrl] = useState<string>("");
  const [photosVersion, setPhotosVersion] = useState(0);

  const [participation, setParticipation] = useState<ParticipationFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all", start: "", end: "" });

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError(null);
      try {
        const all: StaffRegistrationListItem[] = [];
        let page = 1;
        const limit = 500;

        while (true) {
          const res = await fetchRegistrations({ type: "attendee", page, limit });
          if (cancelled) return;
          all.push(...res.data);
          if (page >= res.totalPages) break;
          page++;
        }

        setAllPeople(all);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load registrations");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetchWhosComingPublic()
      .then((data) => {
        setThumbsBaseUrl(data.thumbsBaseUrl);
        setPhotosVersion(data.photosVersion);
      })
      .catch(() => { /* non-fatal — photos fall back to initials */ });
  }, []);

  const filtered = allPeople.filter((p) => {
    if (p.participationType === "donation_only") return false;

    if (participation === "full_celebration" && p.participationType !== "full_celebration") return false;
    if (participation === "campus_only" && p.participationType !== "campus_only") return false;
    if (participation === "confirmed" && p.status !== "confirmed") return false;
    if (participation === "pending" && p.status === "confirmed") return false;

    if (dateRange.start || dateRange.end) {
      const created = new Date(p.createdAt);
      if (dateRange.start) {
        const from = new Date(dateRange.start + "T00:00:00");
        if (created < from) return false;
      }
      if (dateRange.end) {
        const to = new Date(dateRange.end + "T23:59:59");
        if (created > to) return false;
      }
    }

    return true;
  });

  const byBranch = new Map<string, StaffRegistrationListItem[]>();
  for (const p of filtered) {
    const existing = byBranch.get(p.branch);
    if (existing) {
      existing.push(p);
    } else {
      byBranch.set(p.branch, [p]);
    }
  }
  const branchEntries = Array.from(byBranch.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  function handlePreset(preset: DatePreset) {
    const range = getPresetRange(preset);
    setDateRange({ preset, ...range });
  }

  function handleDateInput(field: "start" | "end", value: string) {
    setDateRange((prev) => ({ ...prev, preset: "all", [field]: value }));
  }

  return (
    <div
      className="min-h-screen bg-[#faf7f2]"
      style={{ perspective: "1200px" }}
    >
      <div className="max-w-[1320px] mx-auto px-8 py-8 sm:px-4 sm:py-5">

        <div className="mb-6">
          <h1 className="font-heading text-3xl font-bold text-charcoal leading-tight">
            Who&apos;s Coming
          </h1>
          {!loading && (
            <p
              className="font-accent text-xl mt-1"
              style={{ color: "#D76B51" }}
            >
              {filtered.length} {filtered.length === 1 ? "face" : "faces"} so far!
            </p>
          )}
        </div>

        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            {PARTICIPATION_PILLS.map((pill) => (
              <button
                key={pill.key}
                type="button"
                onClick={() => setParticipation(pill.key)}
                className={[
                  "px-4 py-2 rounded-full text-sm font-semibold border transition-colors min-h-[44px]",
                  participation === pill.key
                    ? "bg-charcoal text-white border-charcoal"
                    : "bg-transparent text-charcoal border-[rgba(31,42,51,0.3)] hover:border-charcoal",
                ].join(" ")}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted font-semibold uppercase tracking-wider">Joined:</span>
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePreset(preset.key)}
                className={[
                  "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors min-h-[36px]",
                  dateRange.preset === preset.key && !(dateRange.start || dateRange.end) || (preset.key === "all" && dateRange.preset === "all" && !dateRange.start && !dateRange.end)
                    ? "bg-charcoal text-white border-charcoal"
                    : "bg-transparent text-charcoal border-[rgba(31,42,51,0.3)] hover:border-charcoal",
                ].join(" ")}
              >
                {preset.label}
              </button>
            ))}
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => handleDateInput("start", e.target.value)}
                className="text-xs border border-[rgba(31,42,51,0.3)] rounded-lg px-2 py-1.5 bg-white text-charcoal focus:outline-none focus:border-charcoal min-h-[36px]"
                aria-label="From date"
              />
              <span className="text-xs text-muted">–</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => handleDateInput("end", e.target.value)}
                className="text-xs border border-[rgba(31,42,51,0.3)] rounded-lg px-2 py-1.5 bg-white text-charcoal focus:outline-none focus:border-charcoal min-h-[36px]"
                aria-label="To date"
              />
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex flex-wrap gap-6">
            {Array.from({ length: 24 }).map((_, i) => (
              <ShimmerCard key={i} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-muted font-body">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-muted font-body text-sm">No attendees match these filters</p>
          </div>
        )}

        {!loading && !error && branchEntries.length > 0 && (
          <div className="space-y-10">
            {branchEntries.map(([branch, people]) => (
              <section key={branch}>
                <p className="font-accent text-lg text-muted mb-4">
                  ✦ {branch} — {people.length} coming
                </p>
                <div
                  className="flex flex-wrap gap-6"
                  style={{ perspective: "1200px" }}
                >
                  {people.map((person, idx) => (
                    <PolaroidCard
                      key={person.id}
                      variant="public"
                      index={idx}
                      href={`/staff/registrations/${person.id}`}
                      branchAccentColor={
                        isBranch(person.branch) ? BRANCH_COLORS[person.branch] : undefined
                      }
                      person={{
                        id: person.id,
                        fullName: person.fullName,
                        subtitle: person.branch,
                        hasPhoto: Boolean(person.photoThumbKey),
                        photoSrc: person.photoThumbKey && thumbsBaseUrl
                          ? publicPhotoUrl(person.id, thumbsBaseUrl, photosVersion)
                          : undefined,
                        status: person.status,
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
