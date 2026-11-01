import { Routes, Route, Outlet, Navigate, useLocation } from "react-router-dom";
import { getAuthRole } from "@/lib/auth";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import RegisterPage from "./pages/RegisterPage";
import NewRegistrationPage from "./pages/NewRegistrationPage";
import BankTransferPage from "./pages/BankTransferPage";
import PaymentAdvicePage from "./pages/PaymentAdvicePage";
import ConfirmationPage from "./pages/ConfirmationPage";
import NotFoundPage from "./pages/NotFoundPage";
import PassPage from "./pages/PassPage";
import HomePage from "./pages/HomePage";
import ConnectPage from "./pages/ConnectPage";
import LoginPage from "./pages/LoginPage";
import { AuthVerifyPage } from "./pages/AuthVerifyPage";
import StaffDashboardPage from "./pages/StaffDashboardPage";
import RegistrationDetailPage from "./pages/RegistrationDetailPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { RoomInventoryPage } from "./pages/RoomInventoryPage";
import { ReportsPage } from "./pages/ReportsPage";
import { StaffLayout } from "./components/staff/StaffLayout";
import { ProtectedRoute } from "./components/staff/ProtectedRoute";
import { RequireScope } from "./components/staff/RequireScope";
import { TeamManagementPage } from "./pages/TeamManagementPage";
import StaffConfigPage from "./pages/StaffConfigPage";
import SizeChartPage from "./pages/SizeChartPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import BankDetailsPage from "./pages/BankDetailsPage";
import { WhosComingPage } from "./pages/WhosComingPage";
import PublicWhosComingPage from "./pages/PublicWhosComingPage";
import CommitteeTodosPage from "./pages/CommitteeTodosPage";
import StaffToolsPage from "./pages/StaffToolsPage";
import DailyReportPage from "./pages/DailyReportPage";
import PredictionsMatchPage from "./pages/PredictionsMatchPage";
import ArchivedRegistrationsPage from "./pages/ArchivedRegistrationsPage";
import ArchivedDetailPage from "./pages/ArchivedDetailPage";
import RefundsPage from "./pages/RefundsPage";
import BankTransactionsPage from "./pages/BankTransactionsPage";
import PredictionAwardsPage from "./pages/PredictionAwardsPage";
import CreditsExportPage from "./pages/CreditsExportPage";
import AllocationPage from "./pages/AllocationPage";
import SponsorPage from "./pages/SponsorPage";
import { RegistrationDeskPage } from "./pages/RegistrationDeskPage";
import { RegistrationDeskDetailPage } from "./pages/RegistrationDeskDetailPage";
import { StaffAccessDeniedPage } from "./pages/StaffAccessDeniedPage";
import LedWallPage from "./pages/LedWallPage";
import LedWallPrecachePage from "./pages/LedWallPrecachePage";
import MagazinePage from "./pages/MagazinePage";
import AutographPage from "./pages/AutographPage";

// Debug pages — only imported and rendered in development.
// Vite replaces import.meta.env.DEV with false in production builds,
// allowing tree-shaking to eliminate these modules from the bundle.
import DebugPage from "./pages/DebugPage";
import DonationCardDebugPage from "./pages/DonationCardDebugPage";
import DebugToolsPage from "./pages/DebugToolsPage";
import StaffDebugPage from "./pages/StaffDebugPage";
import WhosComingDebugPage from "./pages/WhosComingDebugPage";
import AdviceDebugPage from "./pages/AdviceDebugPage";
import LedWallDebugPage from "./pages/LedWallDebugPage";

/**
 * Runtime gate for /debug/* routes — layer 2 of the debug-exposure defense
 * (access-control.spec.md G8).
 *
 * - Dev builds (import.meta.env.DEV): always open — no flag, no auth.
 * - Anywhere the debug code ships (staging, VITE_ENABLE_DEBUG=true builds):
 *   requires an admin session AND the `debug_tools` D1 feature flag.
 *   Non-admin → redirect to /login (same behavior as ProtectedRoute);
 *   admin with flag disabled → 404 page.
 *
 * Layer 1 is the enclosing build-time condition in <App/> below — it must stay
 * statically eliminable (import.meta.env literals only). See src/web/CLAUDE.md.
 */
export function DebugRouteGate() {
  const location = useLocation();
  const role = getAuthRole();
  const isDev = import.meta.env.DEV;
  const { enabled, loading } = useFeatureFlag("debug_tools", {
    skip: isDev || role !== "admin",
  });

  if (isDev) return <Outlet />;
  if (role !== "admin") {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  if (loading) return null;
  return enabled ? <Outlet /> : <NotFoundPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/connect" element={<ConnectPage />} />
      <Route path="/whos-coming" element={<PublicWhosComingPage />} />
      <Route path="/committee/todos" element={<CommitteeTodosPage />} />
      <Route path="/awards" element={<PredictionAwardsPage />} />
      <Route path="/sponsor" element={<SponsorPage />} />
      <Route path="/new" element={<NewRegistrationPage />} />
      <Route path="/led-wall" element={<LedWallPage />} />
      <Route path="/led-wall/precache" element={<LedWallPrecachePage />} />
      <Route path="/magazine" element={<MagazinePage />} />
      <Route path="/memories/stories" element={<AutographPage />} />
      <Route path="/autograph" element={<Navigate to="/memories/stories" replace />} />
      {(import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG === 'true') && (
        <Route element={<DebugRouteGate />}>
          <Route path="/debug" element={<DebugPage />} />
          <Route path="/debug/confirmations" element={<DonationCardDebugPage />} />
          <Route path="/debug/tools" element={<DebugToolsPage />} />
          <Route path="/debug/staff" element={<StaffDebugPage />} />
          <Route path="/debug/whos-coming" element={<WhosComingDebugPage />} />
          <Route path="/debug/advice" element={<AdviceDebugPage />} />
          <Route path="/debug/led-wall" element={<LedWallDebugPage />} />
          <Route path="/debug/credits-export" element={<CreditsExportPage />} />
        </Route>
      )}
      <Route path="/pay/:regCode" element={<BankTransferPage />} />
      <Route path="/pay/:regCode/advice" element={<PaymentAdvicePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/pass" element={<PassPage />} />
      <Route path="/size-chart" element={<SizeChartPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/predictions" element={<PredictionsMatchPage />} />
      <Route path="/bank-details" element={<BankDetailsPage />} />
      <Route path="/confirmation/:id" element={<ConfirmationPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/verify" element={<AuthVerifyPage />} />
      <Route element={<ProtectedRoute requiredRoles={["staff", "admin"]} />}>
        {/* Staff pages each mount <RequireScope> at the top of their tree
            (access-control.spec.md R7); missing scope renders an inline
            "Access denied" state (R5.4), never a raw 403. Scope per the R7
            UI Gate Matrix. */}
        <Route path="/staff" element={<StaffLayout />}>
          <Route path="dashboard" element={<RequireScope scope="dashboard" pageLabel="the dashboard"><StaffDashboardPage /></RequireScope>} />
          <Route path="registrations/:id" element={<RequireScope scope="dashboard" pageLabel="registration details"><RegistrationDetailPage /></RequireScope>} />
          <Route path="resources" element={<RequireScope scope="resources" pageLabel="resources"><ResourcesPage /></RequireScope>} />
          <Route path="rooms" element={<RequireScope scope="resources" pageLabel="room inventory"><RoomInventoryPage /></RequireScope>} />
          <Route path="reports" element={<RequireScope scope="reports" pageLabel="reports"><ReportsPage /></RequireScope>} />
          <Route path="refunds" element={<RequireScope scope="dashboard" pageLabel="refunds"><RefundsPage /></RequireScope>} />
          <Route path="bank-transactions" element={<RequireScope scope="bank_txns" pageLabel="bank transactions"><BankTransactionsPage /></RequireScope>} />
          <Route path="check-in" element={<RequireScope scope="registration_desk" pageLabel="registration desk"><RegistrationDeskPage /></RequireScope>}>
            {/* Nested overlay route — the parent above stays mounted so the typed
                search query survives opening/closing this detail (registration-desk-ui
                plan, ROUTING). A QR/pass deep-link here renders the parent with an
                empty search plus this overlay. */}
            <Route path="registration/:regCode" element={<RegistrationDeskDetailPage />} />
          </Route>
          {/* Role-only landing for empty scopes / permission-fetch failure —
              feature-scope-free, no feature API calls (design.md §Redirect
              algorithm steps 5–6). Must stay OUTSIDE RequireScope. */}
          <Route path="access-denied" element={<StaffAccessDeniedPage />} />
          <Route path="coming" element={<RequireScope scope="dashboard" pageLabel="Who's Coming"><WhosComingPage /></RequireScope>} />
          <Route path="allocation" element={<RequireScope scope="allocation" pageLabel="allocation"><AllocationPage /></RequireScope>} />
          <Route path="tools" element={<RequireScope scope="admin-tools" pageLabel="staff tools"><StaffToolsPage /></RequireScope>} />
          <Route path="daily-report" element={<RequireScope scope="admin-tools" pageLabel="the daily report"><DailyReportPage /></RequireScope>} />
          <Route path="archived" element={<RequireScope scope="dashboard" pageLabel="archived registrations"><ArchivedRegistrationsPage /></RequireScope>} />
          <Route path="archived/:id" element={<RequireScope scope="dashboard" pageLabel="archived registration details"><ArchivedDetailPage /></RequireScope>} />
          <Route element={<ProtectedRoute requiredRoles={["admin"]} />}>
            <Route path="team" element={<TeamManagementPage />} />
            <Route path="config" element={<StaffConfigPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
