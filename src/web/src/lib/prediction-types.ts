export interface DatasourceResponse {
  source: string;
  sheet: string;
  rows: number;
  data: Record<string, string>[];
}

export interface FixtureRow {
  MatchId: string;
  Round: string;
  Stage: string;
  Group?: string;
  KickoffUTC: string;
  LockUTC?: string;
  HomeTeam: string;
  AwayTeam: string;
  ActualHome?: string;
  ActualAway?: string;
  Status?: string;
  Scored?: string;
}

export interface PredictionRow {
  Timestamp: string;
  Email: string;
  MatchId: string;
  PredHome: string;
  PredAway: string;
  PredMOM?: string;
  Joker?: string;
}

export interface ScoreRow {
  Email: string;
  MatchId: string;
  Stage: string;
  Points: string;
  Detail: string;
}

export interface PlayerRow {
  Email: string;
  DisplayName: string;
  Batch: string;
}

export type PredictionTier = "exact" | "goalDiff" | "outcome" | "miss";
export type ReplayFilter = "all" | PredictionTier;

export interface PlayerSummary {
  email: string;
  displayName: string;
  batch: string;
}

export interface ReplayFixture {
  id: string;
  round: string;
  stage: string;
  group: string;
  kickoffUtc: string;
  kickoffLabel: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: number | null;
  actualAway: number | null;
  status: string;
  scored: boolean;
}

export interface ReplayPick {
  rank: number;
  player: PlayerSummary;
  predictedHome: number | null;
  predictedAway: number | null;
  predictedMom: string | null;
  basePoints: number;
  jokerPoints: number;
  upsetPoints: number;
  /** Man-of-the-match guess bonus. Already folded into basePoints — shown separately for display only. */
  momPoints: number;
  totalPoints: number;
  tier: PredictionTier;
  goalsOff: number | null;
}

export interface MatchCrowdSummary {
  predictionsCount: number;
  exactCount: number;
  gotPointsCount: number;
  mostPickedScoreline: string;
}

export interface MatchReplay {
  fixture: ReplayFixture;
  picks: ReplayPick[];
}

export interface MatchPickerOption {
  matchId: string;
  label: string;
  sublabel: string;
  scoreline: string;
  kickoffTime: number;
}

export interface MatchPickerGroup {
  round: string;
  matches: MatchPickerOption[];
}

export interface PredictionsDataset {
  fixtures: FixtureRow[];
  predictions: PredictionRow[];
  scores: ScoreRow[];
  players: PlayerRow[];
}

// --- Ledger types ---

export interface LedgerEntry {
  matchId: string;
  fixture: {
    homeTeam: string;
    awayTeam: string;
    actualHome: number;
    actualAway: number;
    round: string;
    stage: string;
    kickoffUtc: string;
  };
  prediction: {
    predHome: number;
    predAway: number;
    predMom: string | null;
    isJoker: boolean;
  };
  basePoints: number;
  jokerPoints: number;
  upsetPoints: number;
  /** Man-of-the-match guess bonus. Already folded into basePoints — shown separately for display only. */
  momPoints: number;
  totalPoints: number;
  tier: PredictionTier;
  goalsOff: number | null;
  runningBalance: number;
}

export interface LedgerStatsData {
  total: number;
  matchesPlayed: number;
  exactCount: number;
  hitRate: number;
  jokerBonus: number;
  upsetBonus: number;
  momBonus: number;
  tournamentBonus: number;
}

export interface LedgerRoundGroupData {
  round: string;
  subtotal: number;
  exactCount: number;
  entries: LedgerEntry[];
}

export interface ChartPoint {
  matchId: string;
  running: number;
  points: number;
  tier: PredictionTier;
  matchLabel: string;
}

export interface ClosingStatementData {
  matchesPredicted: number;
  resultsCorrect: number;
  hitRate: number;
  exactCount: number;
  goalDiffCount: number;
  outcomeCount: number;
  missCount: number;
  basePoints: number;
  jokerBonus: number;
  upsetBonus: number;
  momBonus: number;
  tournamentBonus: number;
  closingBalance: number;
  bestMatch: { label: string; points: number } | null;
  longestMissStreak: number;
  leaderboardRank: number | null;
}

export interface Standing {
  rank: number;
  leaderDistance: number;
  avgDistance: number;
  average: number;
  isLeading: boolean;
}

export interface PlayerPickerItem {
  displayName: string;
  batch: string;
  totalPoints: number;
  rank: number;
  avatarUrl: string | null;
}

// --- Who's Coming types ---

export interface WhosComingAttendee {
  id: number;
  fullName: string;
  branch: string;
  hasPhoto: boolean;
  emailHash: string;
}

export interface WhosComingResponse {
  people: WhosComingAttendee[];
  count: number;
  thumbsBaseUrl: string;
  photosVersion: number;
}
