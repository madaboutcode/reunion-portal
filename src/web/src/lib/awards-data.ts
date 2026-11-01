export interface AwardWinner {
  name: string;
  /** Omitted for department-level entries (e.g. Rolling Trophy contenders), where `name` is already the branch. */
  branch?: string;
  /** Player handle for ledger links, when different from display name. */
  linkName?: string;
  metric: string;
  detail?: string;
}

export interface Award {
  order: number;
  slug: string;
  title: string;
  subtitle: string;
  criteria: string;
  winners: AwardWinner[];
  metric: string;
  contenders: AwardWinner[];
  stickerPath: string;
  layoutVariant: "standard" | "four_way_tie" | "branch_roll" | "department";
  prize?: string;
}

export interface TournamentPredictor {
  name: string;
  branch: string;
  when: "pre-tournament" | "r16" | "both";
  points: number;
}

export interface TournamentPrediction {
  category: string;
  label: string;
  actual: string;
  predictors: TournamentPredictor[];
}

export const PAGE_META = {
  eyebrow: "World Cup 2026",
  title: "Prediction Awards",
  intro: "The predictions that became bragging rights.",
  sectionTitle: "The winners' roll",
};

export const AWARDS: Award[] = [
  {
    order: 1,
    slug: "nostradamus-of-karicode",
    title: "Nostradamus of Karicode",
    subtitle: "The one who saw it all coming",
    criteria: "Highest total points across the entire tournament.",
    winners: [
      { name: "Asha Example", branch: "Mech Prod", metric: "887 pts", detail: "95 matches" },
    ],
    metric: "887 pts",
    contenders: [
      { name: "Chitra Demo", branch: "EEE", metric: "809 pts", detail: "100 matches" },
      { name: "Esha Test", branch: "Chemical", metric: "798 pts", detail: "103 matches" },
      { name: "Ben Sample", branch: "ECE", metric: "788 pts", detail: "104 matches" },
      { name: "Rahul Krishnan", branch: "EEE", metric: "756 pts", detail: "103 matches" },
    ],
    stickerPath: "/assets/awards/stickers/nostradamus-of-karicode.png",
    layoutVariant: "standard",
    prize: "JBL Essential 2",
  },
  {
    order: 2,
    slug: "chacko-master",
    title: "Chacko Master Award",
    subtitle: "Precision is not a request",
    criteria: "Most exact scoreline predictions.",
    winners: [
      { name: "Asha Example", branch: "Mech Prod", metric: "18 exact scores" },
    ],
    metric: "18 exact scores",
    contenders: [
      { name: "Gita Dummy", branch: "Civil", metric: "16 exact scores" },
      { name: "Rahul Krishnan", branch: "EEE", metric: "15 exact scores" },
      { name: "Ben Sample", branch: "ECE", metric: "14 exact scores" },
      { name: "Farid Mock", branch: "EEE", metric: "14 exact scores" },
    ],
    stickerPath: "/assets/awards/stickers/chacko-master.png",
    layoutVariant: "standard",
  },
  {
    order: 3,
    slug: "velichappadu",
    title: "Velichappadu Award",
    subtitle: "Called it when nobody believed",
    criteria:
      "Most upset bonus points (R32 onward, when fewer than 10% of predictors got the result right).",
    winners: [
      {
        name: "Manu Demo",
        branch: "ECE",
        linkName: "manudemo",
        metric: "10 upset pts",
        detail: "1 upset, exact score",
      },
    ],
    metric: "10 upset pts",
    contenders: [
      { name: "Ben Sample", branch: "ECE", metric: "5 upset pts" },
      { name: "Hari Synthetic", branch: "EEE", metric: "5 upset pts" },
    ],
    stickerPath: "/assets/awards/stickers/velichappadu.png",
    layoutVariant: "standard",
  },
  {
    order: 4,
    slug: "thuruppu-gulan",
    title: "Thuruppu Gulan",
    subtitle: "Played the Joker, doubled the stakes",
    criteria: "Highest total points from Joker plays.",
    winners: [
      { name: "Farid Mock", branch: "EEE", metric: "91 joker pts", detail: "7 jokers" },
    ],
    metric: "91 joker pts",
    contenders: [
      { name: "Jai Fixture", branch: "ECE", metric: "85 joker pts", detail: "7 jokers" },
      { name: "Gita Dummy", branch: "Civil", metric: "81 joker pts", detail: "7 jokers" },
      { name: "Esha Test", branch: "Chemical", metric: "80 joker pts", detail: "7 jokers" },
      { name: "Hari Synthetic", branch: "EEE", metric: "70 joker pts", detail: "6 jokers" },
    ],
    stickerPath: "/assets/awards/stickers/thuruppu-gulan.png",
    layoutVariant: "standard",
  },
  {
    order: 5,
    slug: "fazil",
    title: "Fazil Award",
    subtitle: "Spotted the star before anyone else",
    criteria: "Most correct Man of the Match predictions (+20 pts each, from QF onward).",
    winners: [
      { name: "Farid Mock", branch: "EEE", metric: "3 correct", detail: "60 MoM pts" },
      { name: "Esha Test", branch: "Chemical", metric: "3 correct", detail: "60 MoM pts" },
      { name: "Quin Fixture", branch: "EEE", metric: "3 correct", detail: "60 MoM pts" },
      { name: "Ravi Dummy", branch: "Chemical", metric: "3 correct", detail: "60 MoM pts" },
    ],
    metric: "4-way tie · 3 correct",
    contenders: [
      { name: "Ben Sample", branch: "ECE", metric: "2 correct", detail: "40 MoM pts" },
    ],
    stickerPath: "/assets/awards/stickers/fazil.png",
    layoutVariant: "four_way_tie",
  },
  {
    order: 6,
    slug: "nokia-3310",
    title: "Nokia 3310 Award",
    subtitle: "Unbreakable. Consistent. Never out of range.",
    criteria:
      "Highest hit rate among serious players: 5+ knockout predictions and 3+ of the final 10 matches predicted.",
    winners: [
      {
        name: "Asha Example",
        branch: "Mech Prod",
        metric: "70.5% hit rate",
        detail: "28 misses / 95 matches",
      },
    ],
    metric: "70.5% hit rate",
    contenders: [
      {
        name: "Chitra Demo",
        branch: "EEE",
        metric: "69.0% hit rate",
        detail: "31 misses / 100 matches",
      },
      {
        name: "Ravi Dummy",
        branch: "Chemical",
        metric: "67.5% hit rate",
        detail: "26 misses / 80 matches",
      },
      {
        name: "Rahul Krishnan",
        branch: "EEE",
        metric: "66.0% hit rate",
        detail: "35 misses / 103 matches",
      },
      {
        name: "Esha Test",
        branch: "Chemical",
        metric: "65.0% hit rate",
        detail: "36 misses / 103 matches",
      },
    ],
    stickerPath: "/assets/awards/stickers/nokia-3310.png",
    layoutVariant: "standard",
  },
  {
    order: 7,
    slug: "series-exam-star",
    title: "Series Exam Star",
    subtitle: "Topped the internals. Peak group-stage form.",
    criteria: "Highest total points during the group stage.",
    winners: [
      {
        name: "Asha Example",
        branch: "Mech Prod",
        metric: "326 pts",
        detail: "group stage",
      },
    ],
    metric: "326 pts",
    contenders: [
      { name: "Rahul Krishnan", branch: "EEE", metric: "308 pts" },
      { name: "Esha Test", branch: "Chemical", metric: "307 pts" },
      { name: "Chitra Demo", branch: "EEE", metric: "304 pts" },
      { name: "Ben Sample", branch: "ECE", metric: "300 pts" },
    ],
    stickerPath: "/assets/awards/stickers/series-exam-star.png",
    layoutVariant: "standard",
  },
  {
    order: 8,
    slug: "desert-storm",
    title: "Desert Storm Award",
    subtitle: "Shows up when the stakes are highest",
    criteria: "Highest total points in knockout rounds (R32 onward).",
    winners: [
      {
        name: "Farid Mock",
        branch: "EEE",
        metric: "406 pts",
        detail: "knockouts",
      },
    ],
    metric: "406 pts",
    contenders: [
      { name: "Esha Test", branch: "Chemical", metric: "376 pts" },
      { name: "Gita Dummy", branch: "Civil", metric: "374 pts" },
      { name: "Asha Example", branch: "Mech Prod", metric: "366 pts" },
      { name: "Ravi Dummy", branch: "Chemical", metric: "355 pts" },
    ],
    stickerPath: "/assets/awards/stickers/desert-storm.png",
    layoutVariant: "standard",
  },
  {
    order: 9,
    slug: "kanippayyur-jr",
    title: "Kanippayyur Jr.",
    subtitle: "The branch-level prophet",
    criteria:
      "Top scorer from each engineering branch, for branches with at least 3 participants.",
    winners: [
      { name: "Asha Example", branch: "Mech Prod", metric: "887 pts" },
      { name: "Chitra Demo", branch: "EEE", metric: "809 pts" },
      { name: "Esha Test", branch: "Chemical", metric: "798 pts" },
      { name: "Ben Sample", branch: "ECE", metric: "788 pts" },
      { name: "Omar Mock", branch: "CSE", metric: "731 pts" },
      { name: "Gita Dummy", branch: "Civil", metric: "662 pts" },
      { name: "Priya Placeholder", branch: "Mechanical", metric: "474 pts" },
    ],
    metric: "7 branch leaders",
    contenders: [],
    stickerPath: "/assets/awards/stickers/kanippayyur-jr.png",
    layoutVariant: "branch_roll",
  },
  {
    order: 10,
    slug: "rolling-trophy",
    title: "Rolling Trophy",
    subtitle: "The department that brought it home",
    criteria:
      "Ranked by combined total-points rank and average-points rank (min 3 participants).",
    winners: [
      {
        name: "ECE",
        branch: "Department",
        metric: "Combined 12",
        detail: "7 players · 3627 total pts · 518 avg",
      },
      {
        name: "Chemical",
        branch: "Department",
        metric: "Combined 12",
        detail: "4 players · 2127 total pts · 532 avg",
      },
    ],
    metric: "Tied at 12",
    contenders: [
      { name: "EEE", metric: "Combined 11", detail: "10 players · 475 avg" },
      { name: "Mech Prod", metric: "Combined 8", detail: "3 players · 476 avg" },
      { name: "CSE", metric: "Combined 7", detail: "5 players · 327 avg" },
      { name: "Mechanical", metric: "Combined 3", detail: "8 players · 153 avg" },
      { name: "Civil", metric: "Combined 3", detail: "3 players · 250 avg" },
    ],
    stickerPath: "/assets/awards/stickers/rolling-trophy.png",
    layoutVariant: "department",
  },
];

export const TOURNAMENT_PREDICTIONS: TournamentPrediction[] = [
  {
    category: "champion",
    label: "Champion",
    actual: "Spain",
    predictors: [
      { name: "Chitra Demo", branch: "EEE", when: "pre-tournament", points: 50 },
      { name: "Quin Fixture", branch: "EEE", when: "r16", points: 40 },
    ],
  },
  {
    category: "runner-up",
    label: "Runner-up",
    actual: "Argentina",
    predictors: [
      { name: "Ben Sample", branch: "ECE", when: "both", points: 90 },
      { name: "Lena Sample", branch: "ECE", when: "both", points: 90 },
      { name: "Najaf Imdad", branch: "EEE", when: "both", points: 90 },
      { name: "Rahul Krishnan", branch: "EEE", when: "both", points: 90 },
      { name: "Chitra Demo", branch: "EEE", when: "both", points: 90 },
      { name: "Ravi Dummy", branch: "Chemical", when: "both", points: 90 },
      { name: "Esha Test", branch: "Chemical", when: "pre-tournament", points: 50 },
      { name: "Nila Test", branch: "CSE", when: "pre-tournament", points: 50 },
      { name: "Asha Example", branch: "Mech Prod", when: "pre-tournament", points: 50 },
      { name: "Indu Specimen", branch: "Chemical", when: "r16", points: 40 },
      { name: "Farid Mock", branch: "EEE", when: "r16", points: 40 },
      { name: "Kiran Example", branch: "Mech Prod", when: "r16", points: 40 },
      { name: "Quin Fixture", branch: "EEE", when: "r16", points: 40 },
    ],
  },
  {
    category: "golden-boot",
    label: "Golden Boot",
    actual: "Kylian Mbappé",
    predictors: [
      { name: "Najaf Imdad", branch: "EEE", when: "both", points: 90 },
      { name: "Omar Mock", branch: "CSE", when: "both", points: 90 },
      { name: "Ravi Dummy", branch: "Chemical", when: "both", points: 90 },
      { name: "Asha Example", branch: "Mech Prod", when: "both", points: 90 },
      { name: "Tara Specimen", branch: "Chemical", when: "pre-tournament", points: 50 },
      { name: "Hari Synthetic", branch: "EEE", when: "pre-tournament", points: 50 },
      { name: "Dev Placeholder", branch: "CSE", when: "pre-tournament", points: 50 },
      { name: "Sana Synthetic", branch: "Mechanical", when: "pre-tournament", points: 50 },
      { name: "Ben Sample", branch: "ECE", when: "r16", points: 40 },
      { name: "Jai Fixture", branch: "ECE", when: "r16", points: 40 },
      { name: "Kiran Example", branch: "Mech Prod", when: "r16", points: 40 },
      { name: "Chitra Demo", branch: "EEE", when: "r16", points: 40 },
      { name: "Quin Fixture", branch: "EEE", when: "r16", points: 40 },
    ],
  },
  {
    category: "golden-glove",
    label: "Golden Glove",
    actual: "Unai Simón",
    predictors: [
      { name: "Jai Fixture", branch: "ECE", when: "pre-tournament", points: 50 },
      { name: "Esha Test", branch: "Chemical", when: "pre-tournament", points: 50 },
      { name: "Priya Placeholder", branch: "Mechanical", when: "r16", points: 40 },
      { name: "Omar Mock", branch: "CSE", when: "r16", points: 40 },
      { name: "Asha Example", branch: "Mech Prod", when: "r16", points: 40 },
    ],
  },
];
