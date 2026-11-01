import { useState, useEffect, Fragment } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Select } from "@/components/ui/Select";
import { fetchResources } from "@/lib/staff-api";
import { staffClient } from "@/lib/http";
import type { ResourceCounts } from "@/lib/staff-types";
import { BRANCHES, BRANCH_SHORT_NAMES, ACCOMMODATION_LABELS } from "@/lib/constants";
import { planRooms, roomCount } from "@/lib/accommodation-room-plan";

const TSHIRT_SIZES = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"] as const;

const STATUS_OPTIONS = [
  { key: "confirmed", label: "Confirmed", apiValue: "confirmed" },
  { key: "pending_verification", label: "Needs Verification", apiValue: "pending_verification" },
  { key: "pending", label: "Pending", apiValue: "pending" },
] as const;

const ALL_STATUS_KEYS = STATUS_OPTIONS.map((s) => s.key);

function branchShort(branch: string): string {
  return (BRANCH_SHORT_NAMES as Record<string, string>)[branch] ?? branch;
}

const BRANCH_OPTIONS = [
  { value: "", label: "All Branches" },
  ...BRANCHES.map((b) => ({ value: b, label: branchShort(b) })),
];

function HeadcountBar({ resources }: { resources: ResourceCounts }) {
  const { alumni, spouses, children, guests, total } = resources.headcount;
  const segments = [
    { label: "Alumni", value: alumni },
    { label: "Spouses", value: spouses },
    { label: "Children", value: children },
    { label: "Guests", value: guests },
  ].filter((s) => s.value > 0);

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5 mb-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider">Total Headcount</p>
        <p className="font-body text-3xl font-bold text-charcoal">{total}</p>
      </div>
      <div className="flex gap-4 flex-wrap">
        {segments.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold text-charcoal">{s.value}</span>
            <span className="text-xs text-muted">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MealsCard({ resources }: { resources: ResourceCounts }) {
  const { veg, nonVeg } = resources.meals;
  const total = veg + nonVeg;

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">Catering</p>
      <div className="space-y-3">
        <MealRow label="Vegetarian" value={veg} total={total} color="bg-emerald-500" />
        <MealRow label="Non-Vegetarian" value={nonVeg} total={total} color="bg-red-400" />
      </div>
      <div className="mt-4 pt-3 border-t border-border-warm flex items-baseline justify-between">
        <span className="text-xs text-muted font-semibold uppercase tracking-wider">Total Covers</span>
        <span className="text-lg font-bold text-charcoal">{total}</span>
      </div>
    </div>
  );
}

function MealRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-sm font-semibold text-charcoal">{value}</span>
      </div>
      <div className="h-1.5 bg-border-warm rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AccommodationCard({ resources }: { resources: ResourceCounts }) {
  const navigate = useNavigate();
  const { accommodation } = resources;
  const none = accommodation["none"]?.total ?? 0;
  const roomTypes = ["private", "shared_double", "shared_triple"] as const;
  const plans = Object.fromEntries(roomTypes.map((type) => {
    const bucket = accommodation[type] ?? { total: 0, male: 0, female: 0, other: 0 };
    return [type, planRooms(type, bucket)];
  })) as Record<(typeof roomTypes)[number], ReturnType<typeof planRooms>>;
  const needsRoom = roomTypes.reduce((sum, type) => sum + roomCount(plans[type].rooms), 0);

  const nonNoneTypes = (["private", "shared_double", "shared_triple"] as const).filter(
    (t) => (accommodation[t]?.total ?? 0) > 0,
  );

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider">Accommodation</p>
        <button
          type="button"
          onClick={() => navigate("/staff/rooms")}
          className="text-xs font-semibold text-muted hover:text-terracotta transition underline-offset-2 hover:underline"
        >
          Edit Room Availability
        </button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {nonNoneTypes.length === 0 ? (
            <tr>
              <td className="py-2 text-sm text-muted">None booked yet</td>
              <td className="py-2 text-right text-sm font-semibold text-charcoal">0</td>
            </tr>
          ) : (
            nonNoneTypes.map((type, i) => {
              const bucket = accommodation[type];
              const plan = plans[type];
              const isLast = i === nonNoneTypes.length - 1;
              return (
                <Fragment key={type}>
                  <tr>
                    <td className="pt-2 text-sm text-muted">{ACCOMMODATION_LABELS[type]}</td>
                    <td className="pt-2 text-right text-sm font-semibold text-charcoal">{bucket.total}</td>
                  </tr>
                  <tr className={isLast ? "" : "border-b border-border-warm/30"}>
                    <td className="pb-2.5 pl-3 text-xs text-muted">
                      <div>Men {bucket.male} &middot; Women {bucket.female}{bucket.other > 0 ? <> &middot; Other {bucket.other}</> : ""}</div>
                      <div className="text-[11px] text-muted/80">
                        Vacant beds: M {plan.vacantBeds.male} &middot; W {plan.vacantBeds.female}{plan.vacantBeds.other > 0 ? <> &middot; O {plan.vacantBeds.other}</> : ""}
                      </div>
                    </td>
                    <td />
                  </tr>
                </Fragment>
              );
            })
          )}
          <tr>
            <td className="pt-2 text-sm text-muted">Not Needed</td>
            <td className="pt-2 text-right text-sm font-semibold text-muted">{none}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-4 pt-3 border-t border-border-warm flex items-baseline justify-between">
        <span className="text-xs text-muted font-semibold uppercase tracking-wider">Rooms Needed</span>
        <span className="text-lg font-bold text-charcoal">{needsRoom}</span>
      </div>
    </div>
  );
}

function TshirtTable({ resources }: { resources: ResourceCounts }) {
  const { tshirts } = resources;
  const genders = ["male", "female", "unspecified"] as const;
  const genderLabels: Record<string, string> = { male: "Men", female: "Women", unspecified: "Other" };

  const activeSizes = TSHIRT_SIZES.filter((size) =>
    genders.some((g) => (tshirts[g]?.[size] ?? 0) > 0),
  );

  const activeGenders = genders.filter((g) =>
    TSHIRT_SIZES.some((size) => (tshirts[g]?.[size] ?? 0) > 0),
  );

  if (activeSizes.length === 0) {
    return (
      <div
        className="bg-surface border border-border-warm rounded-2xl p-5"
        style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
      >
        <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-3">T-Shirts</p>
        <p className="text-sm text-muted">No t-shirt sizes recorded yet.</p>
      </div>
    );
  }

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">T-Shirts</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-warm">
              <th className="text-left py-2 pr-4 text-xs text-muted font-semibold uppercase tracking-wider" />
              {activeSizes.map((size) => (
                <th key={size} className="text-center py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">{size}</th>
              ))}
              <th className="text-center py-2 pl-3 text-xs text-charcoal font-bold uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeGenders.map((gender) => {
              const rowTotal = activeSizes.reduce((sum, size) => sum + (tshirts[gender]?.[size] ?? 0), 0);
              return (
                <tr key={gender} className="border-b border-border-warm last:border-b-0">
                  <td className="py-2.5 pr-4 text-muted font-medium">{genderLabels[gender]}</td>
                  {activeSizes.map((size) => {
                    const count = tshirts[gender]?.[size] ?? 0;
                    return (
                      <td key={size} className={`text-center py-2.5 px-3 ${count > 0 ? "font-semibold text-charcoal" : "text-muted/40"}`}>
                        {count > 0 ? count : "—"}
                      </td>
                    );
                  })}
                  <td className="text-center py-2.5 pl-3 font-bold text-charcoal">{rowTotal}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-warm">
              <td className="py-2.5 pr-4 text-xs text-charcoal font-bold uppercase tracking-wider">Total</td>
              {activeSizes.map((size) => {
                const colTotal = activeGenders.reduce((sum, g) => sum + (tshirts[g]?.[size] ?? 0), 0);
                return (
                  <td key={size} className="text-center py-2.5 px-3 font-bold text-charcoal">{colTotal}</td>
                );
              })}
              <td className="text-center py-2.5 pl-3 font-bold text-terracotta text-base">
                {activeGenders.reduce((sum, g) => sum + activeSizes.reduce((s, size) => s + (tshirts[g]?.[size] ?? 0), 0), 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Night label: "2026-08-14" → "Night of Aug 14"
function nightLabel(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  return `Night of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface RoomInventoryData {
  totalRooms: number;
  roomsConsumed: number;
}

function AccommodationByNightCard({ resources }: { resources: ResourceCounts }) {
  const { accommodationByNight } = resources;
  const nights = ["2026-08-14", "2026-08-15"] as const;
  const [inventory, setInventory] = useState<Record<string, RoomInventoryData> | null>(null);

  useEffect(() => {
    staffClient<{ inventory: Record<string, RoomInventoryData> }>("/api/staff/room-inventory")
      .then((data) => setInventory(data.inventory))
      .catch(() => {});
  }, []);

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Accommodation by Night
      </p>
      <div className="grid grid-cols-2 gap-4">
        {nights.map((night) => {
          const bucket = accommodationByNight[night] ?? {
            private: 0,
            privateByGender: { male: 0, female: 0, other: 0 },
            shared_double: { count: 0, rooms: 0 },
            shared_doubleByGender: { male: 0, female: 0, other: 0 },
            shared_triple: { count: 0, rooms: 0 },
            shared_tripleByGender: { male: 0, female: 0, other: 0 },
            extraBeds: 0,
          };
          const privatePlan = planRooms("private", bucket.privateByGender);
          const doublePlan = planRooms("shared_double", bucket.shared_doubleByGender);
          const triplePlan = planRooms("shared_triple", bucket.shared_tripleByGender);
          const totalRoomsConsumed = roomCount(privatePlan.rooms) + roomCount(doublePlan.rooms) + roomCount(triplePlan.rooms);
          const inv = inventory?.[night];
          const isOver = inv != null && totalRoomsConsumed > inv.totalRooms;

          return (
            <div key={night}>
              <div className="text-xs font-bold text-charcoal mb-2 pb-1.5 border-b border-border-warm">
                {nightLabel(night)}
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                <div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted">Private rooms</span>
                    <span className="font-semibold text-charcoal">{bucket.private} <span className="text-muted font-normal">({roomCount(privatePlan.rooms)} rooms)</span></span>
                  </div>
                  <div className="pl-2 text-[10px] text-muted">
                    M: {bucket.privateByGender.male} &ensp; W: {bucket.privateByGender.female}{bucket.privateByGender.other > 0 ? <> &ensp; O: {bucket.privateByGender.other}</> : ""}
                  </div>
                  <div className="pl-2 text-[10px] text-muted/80">Vacant beds — M: {privatePlan.vacantBeds.male} &ensp; W: {privatePlan.vacantBeds.female}{privatePlan.vacantBeds.other > 0 ? <> &ensp; O: {privatePlan.vacantBeds.other}</> : ""}</div>
                </div>
                <div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted">Shared double</span>
                    <span className="font-semibold text-charcoal">
                      {bucket.shared_double.count}{" "}
                      <span className="text-muted font-normal">
                        ({roomCount(doublePlan.rooms)} rooms)
                      </span>
                    </span>
                  </div>
                  <div className="pl-2 text-[10px] text-muted">
                    M: {bucket.shared_doubleByGender.male} &ensp; W: {bucket.shared_doubleByGender.female}{bucket.shared_doubleByGender.other > 0 ? <> &ensp; O: {bucket.shared_doubleByGender.other}</> : ""}
                  </div>
                  <div className="pl-2 text-[10px] text-muted/80">Vacant beds — M: {doublePlan.vacantBeds.male} &ensp; W: {doublePlan.vacantBeds.female}{doublePlan.vacantBeds.other > 0 ? <> &ensp; O: {doublePlan.vacantBeds.other}</> : ""}</div>
                </div>
                <div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted">Shared triple</span>
                    <span className="font-semibold text-charcoal">
                      {bucket.shared_triple.count}{" "}
                      <span className="text-muted font-normal">
                        ({roomCount(triplePlan.rooms)} rooms)
                      </span>
                    </span>
                  </div>
                  <div className="pl-2 text-[10px] text-muted">
                    M: {bucket.shared_tripleByGender.male} &ensp; W: {bucket.shared_tripleByGender.female}{bucket.shared_tripleByGender.other > 0 ? <> &ensp; O: {bucket.shared_tripleByGender.other}</> : ""}
                  </div>
                  <div className="pl-2 text-[10px] text-muted/80">Vacant beds — M: {triplePlan.vacantBeds.male} &ensp; W: {triplePlan.vacantBeds.female}{triplePlan.vacantBeds.other > 0 ? <> &ensp; O: {triplePlan.vacantBeds.other}</> : ""}</div>
                </div>
                <div className="flex justify-between gap-1">
                  <span className="text-muted">Extra beds</span>
                  <span className="font-semibold text-charcoal">{bucket.extraBeds}</span>
                </div>
                {inv != null && (
                  <div className={`flex justify-between gap-1 pt-1.5 mt-1 border-t border-border-warm ${isOver ? "text-terracotta" : ""}`}>
                    <span className={isOver ? "font-semibold" : "text-muted"}>Net rooms</span>
                    <span className={`font-semibold ${isOver ? "text-terracotta" : "text-charcoal"}`}>
                      {totalRoomsConsumed} / {inv.totalRooms}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MealsByParticipationCard({ resources }: { resources: ResourceCounts }) {
  const { campusDayCaterer, ravizBanquet } = resources.mealsByParticipationType;

  function CatererBlock({
    title,
    subtitle,
    data,
  }: {
    title: string;
    subtitle: string;
    data: { headcount: number; veg: number; nonVeg: number };
  }) {
    return (
      <div className="bg-surface border border-border-warm rounded-xl px-4 py-3">
        <p className="text-xs font-bold text-charcoal mb-1">{title}</p>
        <p className="text-[10px] text-muted mb-2.5">{subtitle}</p>
        <p className="text-[28px] font-bold text-charcoal leading-none mb-1.5">
          {data.headcount}{" "}
          <span className="text-[13px] font-normal text-muted">people</span>
        </p>
        <div className="flex gap-3 text-xs">
          <span>
            <span
              className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
              style={{ background: "#A7F3D0" }}
            />
            Veg: <strong>{data.veg}</strong>
          </span>
          <span>
            <span
              className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
              style={{ background: "#FCA5A5" }}
            />
            Non-veg: <strong>{data.nonVeg}</strong>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Headcount &amp; Meals by Caterer
      </p>
      <div className="flex flex-col gap-4">
        <CatererBlock
          title="Campus Day Caterer"
          subtitle="Full + Campus attendees"
          data={campusDayCaterer}
        />
        <CatererBlock
          title="Raviz Banquet Caterer"
          subtitle="Full celebration attendees only"
          data={ravizBanquet}
        />
      </div>
    </div>
  );
}

function ChildrenByAgeBandCard({ resources }: { resources: ResourceCounts }) {
  const { under6, age6to12, age12plus } = resources.childrenByAgeBand;

  const bands = [
    { value: under6, label: "Under 6 — Free" },
    { value: age6to12, label: "Age 6–12" },
    { value: age12plus, label: "Age 13+" },
  ];

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Children by Age Band
      </p>
      <div className="flex flex-col gap-3">
        {bands.map((band) => (
          <div
            key={band.label}
            className="bg-surface border border-border-warm rounded-xl px-5 py-4 text-center"
          >
            <div className="text-[36px] font-bold text-charcoal leading-none">{band.value}</div>
            <div className="text-xs font-medium text-muted mt-0.5">{band.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="bg-surface border border-border-warm rounded-2xl h-[100px] mb-5" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-surface border border-border-warm rounded-2xl h-[200px]" />
        <div className="bg-surface border border-border-warm rounded-2xl h-[200px]" />
      </div>
      <div className="bg-surface border border-border-warm rounded-2xl h-[140px] mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface border border-border-warm rounded-2xl h-[220px]" />
        <div className="bg-surface border border-border-warm rounded-2xl h-[220px]" />
        <div className="bg-surface border border-border-warm rounded-2xl h-[220px]" />
      </div>
    </div>
  );
}

export function ResourcesPage() {
  useDocumentTitle("Resources");

  const [searchParams, setSearchParams] = useSearchParams();

  const statusParam = searchParams.get("status");
  const selectedStatuses: string[] = statusParam
    ? statusParam.split(",").filter(Boolean)
    : [...ALL_STATUS_KEYS];

  const branch = searchParams.get("branch") ?? "";

  const [resources, setResources] = useState<ResourceCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    const apiStatus = selectedStatuses
      .map((k) => STATUS_OPTIONS.find((s) => s.key === k)?.apiValue)
      .filter(Boolean)
      .join(",");

    fetchResources({
      status: apiStatus || undefined,
      branch: branch || undefined,
    })
      .then(({ resources: r }) => {
        if (!alive) return;
        setResources(r);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, branch]);

  function toggleStatus(key: string) {
    const next = selectedStatuses.includes(key)
      ? selectedStatuses.filter((s) => s !== key)
      : [...selectedStatuses, key];

    setSearchParams(
      (prev) => {
        if (next.length === 0 || next.length === ALL_STATUS_KEYS.length) {
          prev.delete("status");
        } else {
          prev.set("status", next.join(","));
        }
        return prev;
      },
      { replace: false },
    );
  }

  function setBranch(value: string) {
    setSearchParams(
      (prev) => {
        if (value) prev.set("branch", value);
        else prev.delete("branch");
        return prev;
      },
      { replace: false },
    );
  }

  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-charcoal mb-6">Resources</h1>
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted font-semibold uppercase tracking-wider mr-1">Include</span>
          {STATUS_OPTIONS.map((option) => {
            const checked = selectedStatuses.includes(option.key);
            return (
              <label
                key={option.key}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold cursor-pointer transition-all select-none ${
                  checked
                    ? "bg-charcoal text-white"
                    : "bg-surface text-muted border border-border-warm hover:text-charcoal"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  onChange={() => toggleStatus(option.key)}
                />
                {option.label}
              </label>
            );
          })}
        </div>

        <div className="w-[160px]">
          <Select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={BRANCH_OPTIONS}
            placeholder="All Branches"
          />
        </div>
      </div>

      {loading ? (
        <PageSkeleton />
      ) : resources ? (
        <>
          <HeadcountBar resources={resources} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <MealsCard resources={resources} />
            <AccommodationCard resources={resources} />
          </div>
          <TshirtTable resources={resources} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <AccommodationByNightCard resources={resources} />
            <MealsByParticipationCard resources={resources} />
            <ChildrenByAgeBandCard resources={resources} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Failed to load resource data.</p>
      )}
    </div>
  );
}
