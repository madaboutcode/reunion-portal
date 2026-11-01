import { Link } from "react-router-dom";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TabItem {
  key: string;
  label: string;
  /** Navigation path — renders as a real <a> so right-click works. */
  href?: string;
  /** Count shown as a chip next to the label. */
  badge?: number;
  /** When true, the tab is not rendered at all (e.g. admin-only tabs). */
  hidden?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeKey: string;
  onTabChange: (key: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function Tabs({ tabs, activeKey, onTabChange }: TabsProps) {
  return (
    <nav role="tablist" className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        if (tab.hidden) return null;

        const isActive = tab.key === activeKey;
        const className = [
          "px-4 py-3 text-sm font-semibold transition-colors duration-150 -mb-px no-underline",
          isActive
            ? "text-terracotta border-b-2 border-terracotta"
            : "text-charcoal hover:text-terracotta",
        ].join(" ");

        const badge = tab.badge !== undefined ? (
          <span className="ml-2 bg-terracotta/10 text-terracotta text-xs font-bold px-1.5 py-0.5 rounded-full">
            {tab.badge}
          </span>
        ) : null;

        if (tab.href) {
          return (
            <Link
              key={tab.key}
              to={tab.href}
              role="tab"
              aria-selected={isActive}
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  onTabChange(tab.key);
                }
              }}
              className={className}
            >
              {tab.label}
              {badge}
            </Link>
          );
        }

        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.key)}
            className={className}
          >
            {tab.label}
            {badge}
          </button>
        );
      })}
    </nav>
  );
}
