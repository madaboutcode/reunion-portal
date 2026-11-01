import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { Badge } from "@/components/ui/Badge";
import { getAuthRole, getAuthSub, getAuthEmail, clearAuth, isAdmin } from "@/lib/auth";
import { clearDraft } from "@/hooks/usePersistence";
import { getMyRegistration } from "@/lib/api";
import { useStaffScopes, clearScopeCache } from "@/hooks/useStaffScopes";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";

export interface SiteNavProps {
  glass?: boolean;
}

export function SiteNav({ glass = false }: SiteNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const { loaded: scopesLoaded, hasScope: checkScope } = useStaffScopes();
  const showStories = useFeatureFlag("navigation_show_stories");
  const showMyPass = useFeatureFlag("navigation_show_my_pass");
  const showRegister = useFeatureFlag("navigation_show_register");
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const role = getAuthRole();
  const authSub = getAuthSub();
  const email = getAuthEmail();
  const isStaff = role === "staff" || role === "admin";
  const isAttendee = role === "attendee";
  const isAuthenticated = role !== null;
  const isStaffMode = location.pathname.startsWith("/staff");
  const navHidden = useScrollDirection(isStaffMode);

  useEffect(() => {
    if (!isAttendee) return;
    getMyRegistration()
      .then((res) => setLiveStatus(res.registration.status))
      .catch(() => {});
  }, [isAttendee, location.pathname]);

  useEffect(() => {
    setOpenDropdown(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!openDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      const ref = dropdownRefs.current[openDropdown!];
      if (ref && !ref.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdown]);

  function handleLogout() {
    clearAuth();
    clearDraft();
    clearScopeCache();
    setMenuOpen(false);
    navigate("/");
  }

  // ── Public nav link styles ──────────────────────────────────────────────

  const publicLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-semibold transition-colors ${
      isActive
        ? glass
          ? "text-white underline underline-offset-4"
          : "text-terracotta underline underline-offset-4"
        : glass
          ? "text-white/80 hover:text-white"
          : "text-charcoal hover:text-terracotta"
    }`;

  // ── Staff nav active state detection ────────────────────────────────────

  const isOnDashboard = location.pathname === "/staff/dashboard";
  const isOnDetail = location.pathname.startsWith("/staff/registrations/");

  function isStaffLinkActive(link: string): boolean {
    if (link === "attendees") {
      return isOnDashboard || isOnDetail;
    }
    if (link === "registration-desk") return location.pathname.startsWith("/staff/check-in");
    if (link === "resources") return location.pathname.startsWith("/staff/resources");
    if (link === "reports") return location.pathname.startsWith("/staff/reports");
    if (link === "allocation") return location.pathname.startsWith("/staff/allocation");
    if (link === "finances") {
      return (
        location.pathname.startsWith("/staff/refunds") ||
        location.pathname.startsWith("/staff/bank-transactions")
      );
    }
    if (link === "refunds") return location.pathname.startsWith("/staff/refunds");
    if (link === "bank-transactions") return location.pathname.startsWith("/staff/bank-transactions");
    if (link === "team") return location.pathname.startsWith("/staff/team");
    if (link === "config") return location.pathname.startsWith("/staff/config");
    if (link === "admin") {
      return (
        location.pathname.startsWith("/staff/team") ||
        location.pathname.startsWith("/staff/config")
      );
    }
    return false;
  }

  const staffLinkClass = (link: string) =>
    `text-sm font-semibold transition-colors ${
      isStaffLinkActive(link)
        ? "text-terracotta underline underline-offset-4"
        : "text-charcoal hover:text-terracotta"
    }`;

  // ── Staff mode nav items ────────────────────────────────────────────────

  interface StaffLink {
    key: string;
    label: string;
    to?: string;
    adminOnly?: boolean;
    scope?: string;
    children?: Array<{ key: string; label: string; to: string; scope?: string }>;
  }

  const staffLinks: StaffLink[] = [
    { key: "attendees", label: "Attendees", to: "/staff/dashboard?type=attendee&status=pending_verification", scope: "dashboard" },
    { key: "registration-desk", label: "Registration Desk", to: "/staff/check-in", scope: "registration_desk" },
    { key: "resources", label: "Resources", to: "/staff/resources", scope: "resources" },
    { key: "reports", label: "Reports", to: "/staff/reports", scope: "reports" },
    { key: "allocation", label: "Allocation", to: "/staff/allocation", scope: "allocation" },
    {
      key: "finances",
      label: "Finances",
      children: [
        { key: "refunds", label: "Refunds", to: "/staff/refunds", scope: "dashboard" },
        { key: "bank-transactions", label: "Bank Transactions", to: "/staff/bank-transactions", scope: "bank_txns" },
      ],
    },
    {
      key: "admin",
      label: "Admin",
      adminOnly: true,
      children: [
        { key: "team", label: "Team", to: "/staff/team" },
        { key: "config", label: "Config", to: "/staff/config" },
      ],
    },
  ];

  const hasScope = (scope?: string): boolean => {
    if (!scope) return true;
    return checkScope(scope as import("@/lib/staff-types").StaffScope);
  };

  const visibleStaffLinks = staffLinks
    .filter((l) => {
      if (l.adminOnly && !isAdmin()) return false;
      if (!scopesLoaded) return false; // hide links until scopes load
      return true;
    })
    .map((l) => (l.children ? { ...l, children: l.children.filter((c) => hasScope(c.scope)) } : l))
    .filter((l) => (l.children ? l.children.length > 0 : hasScope(l.scope)));

  if (isStaffMode) {
    return (
      <>
        <nav
          className="sticky top-0 z-[300] bg-surface border-b border-[rgba(200,180,150,0.2)] shadow-[0_2px_10px_rgba(80,60,40,0.05)]"
        >
          <div className="max-w-[1320px] mx-auto px-5 md:px-14 h-[52px] flex items-center justify-between">
            {/* Left: Compact logo */}
            <Link
              to="/"
              className="shrink-0 hover:opacity-80 transition-opacity"
              aria-label="Smriti 2026 — Home"
            >
              <SmritiLogo size={36} />
            </Link>

            {/* Center: Staff section links (desktop) */}
            <div className="hidden md:flex items-center gap-6">
              {visibleStaffLinks.map((link) =>
                link.children ? (
                  <div
                    key={link.key}
                    ref={(el) => { dropdownRefs.current[link.key] = el; }}
                    className="relative"
                    onMouseEnter={() => setOpenDropdown(link.key)}
                    onMouseLeave={() => setOpenDropdown(null)}
                  >
                    <button
                      type="button"
                      className={staffLinkClass(link.key)}
                      aria-expanded={openDropdown === link.key}
                      onClick={() => setOpenDropdown((v) => v === link.key ? null : link.key)}
                    >
                      {link.label}
                    </button>
                    <div
                      className={`absolute left-0 top-full pt-2 transition-all duration-150 ${
                        openDropdown === link.key ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-1"
                      }`}
                    >
                      <div className="min-w-[180px] rounded-lg border border-[rgba(200,180,150,0.2)] bg-white shadow-lg py-1">
                        {link.children.map((child) => (
                          <Link
                            key={child.key}
                            to={child.to}
                            className={`block px-4 py-2 text-sm font-semibold transition-colors ${
                              isStaffLinkActive(child.key)
                                ? "text-terracotta"
                                : "text-charcoal hover:text-terracotta hover:bg-[rgba(215,107,81,0.05)]"
                            }`}
                            onClick={() => setOpenDropdown(null)}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Link key={link.key} to={link.to!} className={staffLinkClass(link.key)}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>

            {/* Right: email + role + logout (desktop) */}
            <div className="hidden md:flex items-center gap-3">
              {email && (
                <span className="text-xs text-muted">{email}</span>
              )}
              {role && (
                <Badge variant={role === "admin" ? "error" : "info"}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </Badge>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm font-semibold text-charcoal hover:text-terracotta transition-colors"
              >
                Logout
              </button>
            </div>

            {/* Mobile Hamburger */}
            <button
              type="button"
              className="md:hidden flex flex-col items-center justify-center w-10 h-10 gap-[5px] rounded-lg hover:bg-[rgba(215,107,81,0.08)] transition"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className={`block h-[2px] bg-charcoal rounded-full transition-all duration-200 ${menuOpen ? "w-5 translate-y-[7px] rotate-45" : "w-5"}`} />
              <span className={`block h-[2px] bg-charcoal rounded-full transition-all duration-200 ${menuOpen ? "opacity-0 w-5" : "w-5"}`} />
              <span className={`block h-[2px] bg-charcoal rounded-full transition-all duration-200 ${menuOpen ? "w-5 -translate-y-[7px] -rotate-45" : "w-5"}`} />
            </button>
          </div>
        </nav>

        {/* Mobile dropdown (staff mode) */}
        {menuOpen && createPortal(
          <div className="md:hidden fixed left-0 right-0 top-[52px] z-[299] px-5 py-4 flex flex-col gap-4 animate-[fadeIn_0.15s_ease_both] bg-surface/95 backdrop-blur-md border-t border-[rgba(200,180,150,0.2)]">
            {visibleStaffLinks.map((link) =>
              link.children ? (
                <div key={link.key} className="flex flex-col gap-3">
                  <span className={staffLinkClass(link.key)}>{link.label}</span>
                  <div className="flex flex-col gap-3 pl-4">
                    {link.children.map((child) => (
                      <Link
                        key={child.key}
                        to={child.to}
                        className={staffLinkClass(child.key)}
                        onClick={() => setMenuOpen(false)}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link
                  key={link.key}
                  to={link.to!}
                  className={staffLinkClass(link.key)}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ),
            )}
            <hr className="border-[rgba(200,180,150,0.2)]" />
            {email && (
              <span className="text-xs text-muted">{email}</span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm font-semibold text-left text-charcoal hover:text-terracotta transition-colors"
            >
              Logout
            </button>
          </div>,
          document.body,
        )}
      </>
    );
  }

  // ── Public mode ─────────────────────────────────────────────────────────

  return (
    <>
      <nav
        className={[
          "sticky top-0 z-[300] overflow-visible transition-transform duration-300 ease-in-out",
          glass
            ? "bg-black/25 backdrop-blur-md border-b border-white/10"
            : "bg-surface border-b border-[rgba(200,180,150,0.2)] shadow-[0_2px_10px_rgba(80,60,40,0.05)]",
          navHidden ? "-translate-y-[calc(100%+60px)]" : "translate-y-0",
        ].join(" ")}
      >
        <div className="max-w-[1280px] mx-auto px-5 md:px-14 h-[52px] flex items-center justify-between overflow-visible">
          {/* Left: Logo sticker */}
          <Link
            to="/"
            className={`shrink-0 overflow-visible transition-opacity duration-200 ${menuOpen ? "opacity-0 pointer-events-none" : ""}`}
            aria-label="Smriti 2026 — Home"
          >
            <div
              className="rounded-full origin-center bg-white"
              style={{
                transform: "translateY(26px)",
                border: "0.5px solid rgba(180,160,140,0.3)",
                padding: 3,
                boxShadow: "0 2px 6px rgba(80,60,40,0.1)",
              }}
            >
              <SmritiLogo size={78} />
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <NavLink to="/" end className={publicLinkClass}>
              Home
            </NavLink>
            <NavLink to="/awards" className={publicLinkClass}>
              Awards
            </NavLink>
            <NavLink to="/connect" className={publicLinkClass}>
              Connect
            </NavLink>
            <NavLink to="/magazine" className={publicLinkClass}>
              Magazine
            </NavLink>
            {showStories && (
              <NavLink to="/memories/stories" className={publicLinkClass}>
                Autograph
              </NavLink>
            )}
            {!isStaff && (
              <NavLink to="/whos-coming" className={publicLinkClass}>
                Who's Coming
              </NavLink>
            )}
            {!isAuthenticated && (
              <NavLink to="/login" className={publicLinkClass}>
                Login
              </NavLink>
            )}
            {isStaff && checkScope("dashboard") && (
              <NavLink to="/staff/dashboard?type=attendee&status=pending_verification" className={publicLinkClass}>
                Dashboard
              </NavLink>
            )}
            {showMyPass && isAttendee && liveStatus === "confirmed" && (
              <NavLink to={`/confirmation/${authSub}`} className={publicLinkClass}>
                My Pass
              </NavLink>
            )}
            {isAuthenticated && (
              <button
                type="button"
                onClick={handleLogout}
                className={`text-sm font-semibold transition-colors ${glass ? "text-white/80 hover:text-white" : "text-charcoal hover:text-terracotta"}`}
              >
                Logout
              </button>
            )}
            {showRegister && (
              <Link
                to="/register"
                className={`inline-flex items-center px-5 py-2 rounded-full text-sm font-bold transition no-underline ${glass ? "bg-white/15 text-white border border-white/30 hover:bg-white/25" : "bg-terracotta text-white hover:brightness-95"}`}
              >
                Register
              </Link>
            )}
          </div>

          {/* Mobile Hamburger */}
          <button
            type="button"
            className={`md:hidden flex flex-col items-center justify-center w-10 h-10 gap-[5px] rounded-lg transition ${glass ? "hover:bg-white/10" : "hover:bg-[rgba(215,107,81,0.08)]"}`}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={`block h-[2px] rounded-full ${glass ? "bg-white" : "bg-charcoal"} transition-all duration-200 ${menuOpen ? "w-5 translate-y-[7px] rotate-45" : "w-5"}`} />
            <span className={`block h-[2px] rounded-full ${glass ? "bg-white" : "bg-charcoal"} transition-all duration-200 ${menuOpen ? "opacity-0 w-5" : "w-5"}`} />
            <span className={`block h-[2px] rounded-full ${glass ? "bg-white" : "bg-charcoal"} transition-all duration-200 ${menuOpen ? "w-5 -translate-y-[7px] -rotate-45" : "w-5"}`} />
          </button>
        </div>
      </nav>

      {/* Mobile Dropdown (public mode) */}
      {menuOpen && createPortal(
        <div className={`md:hidden fixed left-0 right-0 top-[52px] z-[299] px-5 py-4 flex flex-col gap-4 animate-[fadeIn_0.15s_ease_both] ${glass ? "bg-black/25 backdrop-blur-md border-t border-white/10" : "bg-surface/95 backdrop-blur-md border-t border-[rgba(200,180,150,0.2)]"}`}>
          <NavLink to="/" end className={publicLinkClass} onClick={() => setMenuOpen(false)}>
            Home
          </NavLink>
          <NavLink to="/awards" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
            Awards
          </NavLink>
          <NavLink to="/connect" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
            Connect
          </NavLink>
          <NavLink to="/magazine" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
            Magazine
          </NavLink>
          {showStories && (
            <NavLink to="/memories/stories" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
              Autograph
            </NavLink>
          )}
          {!isStaff && (
            <NavLink to="/whos-coming" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
              Who's Coming
            </NavLink>
          )}
          {!isAuthenticated && (
            <NavLink to="/login" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
              Login
            </NavLink>
          )}
          {isStaff && checkScope("dashboard") && (
            <NavLink to="/staff/dashboard?type=attendee&status=pending_verification" className={publicLinkClass} onClick={() => setMenuOpen(false)}>
              Dashboard
            </NavLink>
          )}
          {showMyPass && isAttendee && liveStatus === "confirmed" && (
            <NavLink to={`/confirmation/${authSub}`} className={publicLinkClass} onClick={() => setMenuOpen(false)}>
              My Pass
            </NavLink>
          )}
          {isAuthenticated && (
            <button
              type="button"
              onClick={handleLogout}
              className={`text-sm font-semibold text-left transition-colors ${glass ? "text-white/80 hover:text-white" : "text-charcoal hover:text-terracotta"}`}
            >
              Logout
            </button>
          )}
          {showRegister && (
            <Link
              to="/register"
              className={`inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-bold transition no-underline ${glass ? "bg-white/15 text-white border border-white/30 hover:bg-white/25" : "bg-terracotta text-white hover:brightness-95"}`}
              onClick={() => setMenuOpen(false)}
            >
              Register
            </Link>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
