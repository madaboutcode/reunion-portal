import { useState } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { DataTable, type Column } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { Tabs } from "@/components/ui/Tabs";
import { FilterPills } from "@/components/ui/FilterPills";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchInput } from "@/components/ui/SearchInput";
import { Button } from "@/components/ui/Button";

// ── Types ──────────────────────────────────────────────────────────────────

type StaffTab =
  | "table"
  | "pagination"
  | "tabs"
  | "filterpills"
  | "toast"
  | "confirmdialog"
  | "avatar"
  | "emptystate"
  | "searchinput";

const TABS: { key: StaffTab; label: string }[] = [
  { key: "table", label: "DataTable" },
  { key: "pagination", label: "Pagination" },
  { key: "tabs", label: "Tabs" },
  { key: "filterpills", label: "FilterPills" },
  { key: "toast", label: "Toast" },
  { key: "confirmdialog", label: "ConfirmDialog" },
  { key: "avatar", label: "Avatar" },
  { key: "emptystate", label: "EmptyState" },
  { key: "searchinput", label: "SearchInput" },
];

// ── Mock Data ──────────────────────────────────────────────────────────────

interface MockRegistration {
  id: string;
  name: string;
  email: string;
  branch: string;
  status: string;
}

const mockRegistrations: MockRegistration[] = [
  {
    id: "REG001",
    name: "Test Attendee One",
    email: "attendee1@example.com",
    branch: "Computer Science & Engineering",
    status: "Confirmed",
  },
  {
    id: "REG002",
    name: "Test Attendee Two",
    email: "attendee2@example.com",
    branch: "Electronics & Communication Engineering",
    status: "Pending",
  },
  {
    id: "REG003",
    name: "Test Attendee Three",
    email: "attendee3@example.com",
    branch: "Mechanical Engineering",
    status: "Confirmed",
  },
  {
    id: "REG004",
    name: "Test Attendee Four",
    email: "attendee4@example.com",
    branch: "Civil Engineering",
    status: "Cancelled",
  },
  {
    id: "REG005",
    name: "Test Attendee Five",
    email: "attendee5@example.com",
    branch: "Chemical Engineering",
    status: "Pending",
  },
  {
    id: "REG006",
    name: "Test Attendee Six",
    email: "attendee6@example.com",
    branch: "Electrical & Electronics Engineering",
    status: "Confirmed",
  },
  {
    id: "REG007",
    name: "Test Attendee Seven",
    email: "attendee7@example.com",
    branch: "Architecture",
    status: "Pending",
  },
  {
    id: "REG008",
    name: "Test Attendee Eight",
    email: "attendee8@example.com",
    branch: "Production Engineering",
    status: "Confirmed",
  },
];

function statusBadge(status: string) {
  const classes =
    status === "Confirmed"
      ? "bg-green-100 text-green-700"
      : status === "Pending"
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";

  return (
    <span
      className={["px-2 py-0.5 rounded-full text-xs font-semibold", classes].join(
        " ",
      )}
    >
      {status}
    </span>
  );
}

// ── Demos ──────────────────────────────────────────────────────────────────

function TableDemo() {
  const [data, setData] = useState(mockRegistrations);

  const columns: Column<MockRegistration>[] = [
    {
      key: "id",
      header: "Reg ID",
      render: (r) => <span className="font-mono text-xs">{r.id}</span>,
      width: "100px",
    },
    { key: "name", header: "Name", render: (r) => r.name },
    { key: "email", header: "Email", render: (r) => r.email },
    { key: "branch", header: "Branch", render: (r) => r.branch },
    {
      key: "status",
      header: "Status",
      render: (r) => statusBadge(r.status),
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Clickable Rows
        </h3>
        <p className="text-sm text-muted mb-3">
          Click any row to see an alert with the registration details.
        </p>
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) =>
            alert(`Clicked: ${row.name} (${row.id}) — ${row.status}`)
          }
        />
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Empty State
        </h3>
        <p className="text-sm text-muted mb-3">
          <button
            type="button"
            className="text-terracotta hover:underline text-sm"
            onClick={() =>
              setData(data.length === 0 ? mockRegistrations : [])
            }
          >
            {data.length === 0 ? "Restore data" : "Clear all data →"}
          </button>
        </p>
        <DataTable
          columns={columns}
          data={data.length === 0 ? [] : data}
          emptyMessage="No registrations found. Try adjusting your filters."
        />
      </section>
    </div>
  );
}

function PaginationDemo() {
  const [page, setPage] = useState(1);
  const totalPages = 8;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Interactive Pagination
        </h3>
        <p className="text-sm text-muted mb-3">
          Current page:{" "}
          <span className="font-semibold text-charcoal">
            {page} / {totalPages}
          </span>
        </p>
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Single Page (hidden)
        </h3>
        <p className="text-sm text-muted mb-3">
          Pagination returns <code className="text-charcoal">null</code> when{" "}
          <code className="text-charcoal">totalPages ≤ 1</code>.
        </p>
        <div className="border border-dashed border-border rounded-xl p-4 text-center text-sm text-subtle">
          <Pagination page={1} totalPages={1} onPageChange={() => {}} />
          <span className="mt-2 block">
            ↑ Nothing rendered above — component returned null
          </span>
        </div>
      </section>
    </div>
  );
}

function TabsDemo() {
  const [activeKey, setActiveKey] = useState("all");

  const tabs = [
    { key: "all", label: "All", badge: 42 },
    { key: "confirmed", label: "Confirmed", badge: 28 },
    { key: "pending", label: "Pending", badge: 10 },
    { key: "cancelled", label: "Cancelled", badge: 4 },
    { key: "admin", label: "Admin Only", hidden: true },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Tabs with Badges
        </h3>
        <p className="text-sm text-muted mb-3">
          Active:{" "}
          <span className="font-semibold text-charcoal">{activeKey}</span>
          {" · "}
          <span className="text-xs text-subtle">
            &ldquo;Admin Only&rdquo; tab is hidden
          </span>
        </p>
        <Tabs tabs={tabs} activeKey={activeKey} onTabChange={setActiveKey} />
      </section>

      <section className="p-4 bg-soft-aqua-light rounded-lg">
        <h4 className="font-heading text-sm font-bold text-charcoal mb-1">
          Active Tab Content
        </h4>
        <p className="text-sm text-muted">
          {activeKey === "all" && "Showing all registrations (42 total)."}
          {activeKey === "confirmed" &&
            "Showing confirmed registrations (28 total)."}
          {activeKey === "pending" &&
            "Showing pending registrations (10 total)."}
          {activeKey === "cancelled" &&
            "Showing cancelled registrations (4 total)."}
        </p>
      </section>
    </div>
  );
}

function FilterPillsDemo() {
  const [activeKey, setActiveKey] = useState("all");

  const options = [
    { key: "all", label: "All", count: 42 },
    { key: "confirmed", label: "Confirmed", count: 28 },
    { key: "pending", label: "Pending", count: 10 },
    { key: "cancelled", label: "Cancelled", count: 4 },
    { key: "unpaid", label: "Unpaid" },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Pills with Counts
        </h3>
        <p className="text-sm text-muted mb-3">
          Active:{" "}
          <span className="font-semibold text-charcoal">{activeKey}</span>
        </p>
        <FilterPills
          options={options}
          activeKey={activeKey}
          onChange={setActiveKey}
        />
      </section>

      <section className="p-4 bg-soft-aqua-light rounded-lg">
        <h4 className="font-heading text-sm font-bold text-charcoal mb-1">
          Active Filter
        </h4>
        <p className="text-sm text-muted">
          {activeKey === "all" && "No filter applied — all records visible."}
          {activeKey === "confirmed" &&
            "Filtering by confirmed status only."}
          {activeKey === "pending" && "Filtering by pending status only."}
          {activeKey === "cancelled" &&
            "Filtering by cancelled status only."}
          {activeKey === "unpaid" &&
            "Filtering unpaid registrations (count TBD)."}
        </p>
      </section>
    </div>
  );
}

function ToastDemo() {
  return (
    <ToastProvider>
      <ToastDemoInner />
    </ToastProvider>
  );
}

function ToastDemoInner() {
  const toast = useToast();
  const [count, setCount] = useState(0);

  const trigger = (fn: () => void) => {
    fn();
    setCount((c) => c + 1);
  };

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Success Toast
        </h3>
        <Button
          onClick={() =>
            trigger(() => toast.success("Payment verified successfully!"))
          }
        >
          Trigger Success
        </Button>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Error Toast
        </h3>
        <Button
          variant="secondary"
          onClick={() =>
            trigger(() =>
              toast.error("Upload failed. Please try again."),
            )
          }
        >
          Trigger Error
        </Button>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Stress Test
        </h3>
        <p className="text-sm text-muted mb-2">
          Fires 5 toasts rapidly. Max 3 visible at once — oldest are dropped.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            for (let i = 0; i < 5; i++) {
              setTimeout(() => {
                toast.success(`Toast #${i + 1}`);
                setCount((c) => c + 1);
              }, i * 100);
            }
          }}
        >
          Fire 5 Toasts
        </Button>
      </section>

      <p className="text-xs text-muted">Toasts triggered: {count}</p>
    </div>
  );
}

function ConfirmDialogDemo() {
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Primary Confirm
        </h3>
        <Button onClick={() => setPrimaryOpen(true)}>
          Open Primary Dialog
        </Button>
        <ConfirmDialog
          open={primaryOpen}
          title="Delete Registration?"
          message="Are you sure you want to delete registration REG001? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            setPrimaryOpen(false);
            setResult("Deleted REG001");
          }}
          onCancel={() => setPrimaryOpen(false)}
        />
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Danger Confirm with Loading
        </h3>
        <Button variant="secondary" onClick={() => setDangerOpen(true)}>
          Open Danger Dialog
        </Button>
        <ConfirmDialog
          open={dangerOpen}
          title="Permanently Delete?"
          message="This will permanently remove all data for this registration. There is no recovery."
          confirmLabel="Delete Forever"
          confirmVariant="danger"
          loading={loading}
          onConfirm={() => {
            setLoading(true);
            setTimeout(() => {
              setLoading(false);
              setDangerOpen(false);
              setResult("Permanently deleted all data");
            }, 2000);
          }}
          onCancel={() => setDangerOpen(false)}
        />
      </section>

      {result && (
        <section className="p-4 bg-soft-aqua-light rounded-lg">
          <h4 className="font-heading text-sm font-bold text-charcoal mb-1">
            Last Action
          </h4>
          <p className="text-sm text-muted">{result}</p>
        </section>
      )}
    </div>
  );
}

function AvatarDemo() {
  const names = [
    "Sample Name",
    "Priya",
    "Sample Name",
    "Test Person",
    "V",
    "",
  ];

  return (
    <div className="space-y-10">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Cyan (default) — Medium
        </h3>
        <div className="flex gap-4 items-center flex-wrap">
          {names.map((name) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <Avatar name={name} colorScheme="cyan" size="md" />
              <span className="text-[10px] text-subtle font-mono">
                {name || "(empty)"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Terracotta — Medium
        </h3>
        <div className="flex gap-4 items-center flex-wrap">
          {names.map((name) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <Avatar name={name} colorScheme="terracotta" size="md" />
              <span className="text-[10px] text-subtle font-mono">
                {name || "(empty)"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Small Size — Both Colors
        </h3>
        <div className="space-y-3">
          <div className="flex gap-4 items-center flex-wrap">
            <span className="text-xs text-muted w-24">Cyan sm:</span>
            {names.map((name) => (
              <Avatar
                key={`cyan-sm-${name}`}
                name={name}
                colorScheme="cyan"
                size="sm"
              />
            ))}
          </div>
          <div className="flex gap-4 items-center flex-wrap">
            <span className="text-xs text-muted w-24">Terracotta sm:</span>
            {names.map((name) => (
              <Avatar
                key={`terr-sm-${name}`}
                name={name}
                colorScheme="terracotta"
                size="sm"
              />
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Initials Extraction
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full max-w-md text-sm border-collapse">
            <thead>
              <tr className="bg-[#FAFAF8] border-b border-border">
                <th className="text-left px-3 py-2 text-xs text-muted font-semibold uppercase">
                  Input
                </th>
                <th className="text-left px-3 py-2 text-xs text-muted font-semibold uppercase">
                  Initials
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { input: "Sample Name", expected: "SN" },
                { input: "Priya", expected: "P" },
                { input: "Sample Name", expected: "SN" },
                { input: "Test Person", expected: "TP" },
                { input: "V", expected: "V" },
                { input: "", expected: "?" },
              ].map(({ input, expected }) => (
                <tr key={input} className="border-b border-border">
                  <td className="px-3 py-2 font-mono text-charcoal">
                    {input || "(empty)"}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted">
                    {expected}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EmptyStateDemo() {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          With Icon
        </h3>
        <div className="border border-border rounded-xl">
          <EmptyState
            message="No registrations found for this filter. Try adjusting your search criteria."
            icon={
              <svg
                className="w-12 h-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
            }
          />
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Without Icon
        </h3>
        <div className="border border-border rounded-xl">
          <EmptyState message="No results match your search." />
        </div>
      </section>
    </div>
  );
}

function SearchInputDemo() {
  const [value, setValue] = useState("");
  const [debouncedValue, setDebouncedValue] = useState("");
  const [changeCount, setChangeCount] = useState(0);

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Interactive with Debounce
        </h3>
        <p className="text-sm text-muted mb-3">
          Type in the box. The debounced value updates after 300ms of
          inactivity.
        </p>
        <div className="max-w-sm">
          <SearchInput
            value={value}
            onChange={(v) => {
              setValue(v);
              setDebouncedValue(v);
              setChangeCount((c) => c + 1);
            }}
            placeholder="Search registrations..."
          />
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="text-muted">Last debounced value:</span>{" "}
            <span className="font-mono text-charcoal font-semibold">
              {debouncedValue || "(empty)"}
            </span>
          </p>
          <p>
            <span className="text-muted">Debounce callbacks fired:</span>{" "}
            <span className="font-mono text-charcoal font-semibold">
              {changeCount}
            </span>
          </p>
          <p className="text-xs text-subtle">
            Type quickly — the debounced value lags behind your typing.
          </p>
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-charcoal mb-3">
          Pre-filled Value
        </h3>
        <div className="max-w-sm">
          <SearchInput
            value="Ravi"
            onChange={() => {}}
            placeholder="Search..."
          />
        </div>
      </section>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StaffDebugPage() {
  useDocumentTitle("Staff Debug");
  const [tab, setTab] = useState<StaffTab>("table");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-page flex flex-col md:flex-row">
      {/* Mobile header */}
      <div className="md:hidden bg-charcoal text-white p-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-lg font-bold">
            Staff Components
          </h1>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="text-sm text-gray-300"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>
        {mobileMenuOpen && (
          <nav className="mt-3 flex flex-col gap-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setMobileMenuOpen(false);
                }}
                className={`text-left px-3 py-2 rounded text-sm ${
                  tab === key
                    ? "bg-terracotta text-white"
                    : "text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Desktop sidebar */}
      <aside className="w-[200px] bg-charcoal text-white shrink-0 sticky top-0 h-screen overflow-y-auto hidden md:block">
        <div className="p-4">
          <h1 className="font-heading text-lg font-bold">
            Staff Components
          </h1>
          <p className="text-subtle text-xs mt-1">Debug &amp; Test</p>
        </div>
        <nav className="mt-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-terracotta text-white"
                  : "text-gray-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 p-6">
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-charcoal mb-4">
            {TABS.find((t) => t.key === tab)?.label}
          </h2>
          {tab === "table" && <TableDemo />}
          {tab === "pagination" && <PaginationDemo />}
          {tab === "tabs" && <TabsDemo />}
          {tab === "filterpills" && <FilterPillsDemo />}
          {tab === "toast" && <ToastDemo />}
          {tab === "confirmdialog" && <ConfirmDialogDemo />}
          {tab === "avatar" && <AvatarDemo />}
          {tab === "emptystate" && <EmptyStateDemo />}
          {tab === "searchinput" && <SearchInputDemo />}
        </section>
      </main>
    </div>
  );
}
