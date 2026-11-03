export type CreditEntry =
  | { kind: "intro"; dept: string; title: string; caption?: string }
  | {
      kind: "person";
      dept: string;
      name: string;
      /** Engineering branch, short form (CSE, EEE…) — shown after the name. */
      branch?: string;
      note?: string;
      maskedSrc: string;
      revealSrc: string;
      /** "fitted" scales the reveal down inside a feathered black vignette
       *  instead of full-bleed cover — for tight close-ups that look
       *  overwhelming blown up across the whole frame. */
      revealFit?: "cover" | "fitted";
    }
  | { kind: "joke"; dept: string; name: string }
  | { kind: "end"; caption?: string };

const ASSETS = "/assets/credits";

/** Neutral stand-in for every portrait. Replace with your own masked/real
 *  photo pairs (see README "Make it yours"). */
const PLACEHOLDER_SRC = `${ASSETS}/placeholder-person.svg`;

/** Shared still behind intro + joke credits (the masked trio). */
export const GANG_SRC = PLACEHOLDER_SRC;

/** Vertical recomposition of the trio, served on narrow screens where the
 *  16:9 gang shot would cover-crop down to a single face. */
export const GANG_PORTRAIT_SRC = PLACEHOLDER_SRC;

/** The real contest credits — `<CreditsReel />` renders these with no props. */
export const DEFAULT_ENTRIES: CreditEntry[] = [
  {
    kind: "intro",
    dept: "ഒരു സ്മൃതി 2026 ചിത്രം · A Smriti 2026 Picture",
    title: "Prediction Contest",
    caption: "“ഹലോ… ആരാ സംസാരിക്കുന്നെ?”",
  },
  {
    kind: "person",
    dept: "കഥ, തിരക്കഥ, സംവിധാനം",
    name: "Najaf Imdad",
    branch: "EEE",
    note: "Idea · Game Master · Coordination",
    maskedSrc: PLACEHOLDER_SRC,
    revealSrc: PLACEHOLDER_SRC,
  },
  {
    kind: "person",
    dept: "പശ്ചാത്തല സ്കോർ · Background Score",
    name: "Rahul Krishnan",
    branch: "EEE",
    note: "Predictions · Scoring · The Engine",
    maskedSrc: PLACEHOLDER_SRC,
    revealSrc: PLACEHOLDER_SRC,
    revealFit: "fitted",
  },
  {
    kind: "person",
    dept: "സെറ്റ് നിർമ്മാണം · Set Construction",
    name: "Ajeesh Mohan",
    branch: "CSE",
    note: "The Contest Website · Leaderboard",
    maskedSrc: PLACEHOLDER_SRC,
    revealSrc: PLACEHOLDER_SRC,
  },
  {
    kind: "person",
    dept: "എക്സിക്യൂട്ടീവ് പ്രൊഡ്യൂസർ · Executive Producer",
    name: "Aslam Abdulrahiman",
    branch: "PROD",
    note: "Prize Sponsor · Guidance · Blessings",
    maskedSrc: PLACEHOLDER_SRC,
    revealSrc: PLACEHOLDER_SRC,
    revealFit: "fitted",
  },
  {
    kind: "person",
    dept: "Additional Programming",
    name: "Ponnu A. Lekshmi",
    note: "Prediction Contest · Home Page · Events Pages",
    maskedSrc: PLACEHOLDER_SRC,
    revealSrc: PLACEHOLDER_SRC,
  },
  { kind: "joke", dept: "Stunts", name: "VAR" },
  { kind: "joke", dept: "Villain", name: "The Group-Stage Upsets" },
  { kind: "joke", dept: "Catering", name: "Kanji & Payar" },
  {
    kind: "joke",
    dept: "Produced By",
    name: "TKMCE Class of 2006 · “Smriti”",
  },
  { kind: "end", caption: "“ഇനി നേരിട്ട് കാണാം…”" },
];
