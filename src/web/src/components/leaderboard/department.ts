export type DeptCode = "CSE" | "EEE" | "MECH" | "PROD" | "CHEM" | "ECE" | "CIVIL";

const DEPT_PILL_CLASSES: Record<DeptCode, string> = {
  CSE: "bg-[#2D6FB0]",
  EEE: "bg-[#1FA089]",
  MECH: "bg-[#5C9A3A]",
  PROD: "bg-[#D9591F]",
  CHEM: "bg-[#8456C0]",
  ECE: "bg-[#3B74D6]",
  CIVIL: "bg-[#C2761F]",
};

const DEPT_TRACK_CLASSES: Record<DeptCode, string> = {
  CSE: "from-[#10243a] to-[#1f4d75]",
  EEE: "from-[#0f7c6e] to-[#22b39c]",
  MECH: "from-[#3f7a23] to-[#69a83c]",
  PROD: "from-[#a03e10] to-[#d9591f]",
  CHEM: "from-[#6a3aa8] to-[#9a5fd0]",
  ECE: "from-[#1f4fb0] to-[#3f74d6]",
  CIVIL: "from-[#a05a10] to-[#c2761f]",
};

export function getDeptCode(department: string): DeptCode | string {
  const upper = department.toUpperCase();

  if (upper.includes("COMPUTER") || upper === "CSE") return "CSE";
  if (
    (upper.includes("ELECTRICAL") && upper.includes("ELECTRONICS")) ||
    upper === "EEE"
  ) {
    return "EEE";
  }
  if (
    upper.includes("ELECTRONICS") ||
    upper.includes("COMMUNICATION") ||
    upper === "ECE"
  ) {
    return "ECE";
  }
  if (upper.includes("ELECTRICAL")) return "EEE";
  if (upper.includes("PRODUCTION") || upper === "PROD") return "PROD";
  if (upper.includes("MECHANICAL") || upper === "MECH") return "MECH";
  if (upper.includes("CHEMICAL") || upper === "CHEM") return "CHEM";
  if (upper.includes("CIVIL")) return "CIVIL";

  const short = department.trim().slice(0, 5).toUpperCase();
  return short || "—";
}

export function getDeptPillClass(code: string): string {
  if (code in DEPT_PILL_CLASSES) {
    return DEPT_PILL_CLASSES[code as DeptCode];
  }
  return "bg-[#0a1628]";
}

export function getDeptTrackClass(code: string): string {
  if (code in DEPT_TRACK_CLASSES) {
    return DEPT_TRACK_CLASSES[code as DeptCode];
  }
  return "from-[#0a1628] to-[#1f3a52]";
}