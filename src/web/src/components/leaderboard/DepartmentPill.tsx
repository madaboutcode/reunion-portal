import { getDeptCode, getDeptPillClass } from "./department";

export function DepartmentPill({
  department,
  className = "",
}: {
  department: string;
  className?: string;
}) {
  const code = getDeptCode(department);

  return (
    <span
      className={`inline-block rounded-md px-2.5 py-0.5 text-[11px] font-bold tracking-[0.06em] text-white ${getDeptPillClass(code)} ${className}`}
    >
      {code}
    </span>
  );
}