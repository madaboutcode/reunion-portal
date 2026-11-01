export interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  department: string;
  points: number;
  mainPts: number;
}

export interface LeaderboardResponse {
  source: string;
  sheet: string;
  rows: number;
  data: Record<string, string>[];
}

/** Dense ranking: tied scores share a rank; next distinct score gets rank + 1. */
export function assignDenseRanks(
  entries: Array<{
    name: string;
    department: string;
    points: number;
    mainPts: number;
  }>,
): LeaderboardEntry[] {
  let rank = 1;

  return entries.map((entry, index) => {
    if (index > 0 && entry.points < entries[index - 1].points) {
      rank += 1;
    }

    return {
      ...entry,
      id: `${entry.name}::${entry.department}::${index}`,
      rank,
    };
  });
}

export function parseLeaderboardData(
  data: Record<string, string>[],
): LeaderboardEntry[] {
  const sorted = data
    .map((row) => ({
      name:
        row.DisplayName ??
        row.Name ??
        row.name ??
        "",
      department:
        row.Batch ??
        row.Department ??
        row.department ??
        row.batch ??
        "",
      points:
        Number.parseInt(
          row.Total ?? row.Points ?? row.points ?? row.total ?? "0",
          10,
        ) || 0,
      mainPts:
        Number.parseInt(row.MainPts ?? "0", 10) || 0,
    }))
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  return assignDenseRanks(sorted);
}