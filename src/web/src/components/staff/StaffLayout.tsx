import { Outlet } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { StaffFooter } from "@/components/staff/StaffFooter";

export function StaffLayout() {
  return (
    <div className="min-h-screen bg-page flex flex-col">
      <SiteNav />

      <main className="max-w-[1320px] w-full mx-auto px-5 py-6 flex-1">
        <Outlet />
      </main>

      <StaffFooter />
    </div>
  );
}
