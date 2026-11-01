export interface PostcardAsset {
  label: string;
  rotation: number;
  accent: "tape" | "pin" | "none";
  spritePosition: string;
}

export type TimelineIconName = "building" | "bus" | "music";

export interface ChapterContent {
  title: string;
  body: string;
  icon: TimelineIconName;
  items: string[];
}

const SPRITE_1X = "/assets/registration/postcards/postcard-sprite.webp";
const SPRITE_2X = "/assets/registration/postcards/postcard-sprite-2x.webp";

export const SPRITE_SRC = { x1: SPRITE_1X, x2: SPRITE_2X } as const;

export const CHAPTERS: Record<"campus" | "raviz" | "evening", ChapterContent> = {
  campus: {
    title: "TKMCE Campus",
    body: "Registration, inaugural function, lunch, corridor walk.",
    icon: "building",
    items: ["Registration", "Inaugural", "Lunch", "Corridors & batch moments"],
  },
  raviz: {
    title: "To Raviz Ashtamudi",
    body: "3:30 PM departure, 4:30 PM seating.",
    icon: "bus",
    items: ["3:30 PM Depart", "4:30 PM Seating"],
  },
  evening: {
    title: "Evening, Night",
    body: "Violin concert, dinner, DJ night, conversations. Stay as long as the stories last.",
    icon: "music",
    items: ["Violin concert", "Dinner", "DJ night", "Conversations"],
  },
};

export const PARTICIPATION_POSTCARDS = {
  campus: {
    label: "TKMCE Campus",
    rotation: -3,
    accent: "tape",
    spritePosition: "0% 0%",
  },
  raviz: {
    label: "The Raviz",
    rotation: 4,
    accent: "pin",
    spritePosition: "100% 0%",
  },
  violin: {
    label: "Violin Concert",
    rotation: -2,
    accent: "pin",
    spritePosition: "0% 100%",
  },
  dj: {
    label: "DJ Night",
    rotation: 2,
    accent: "pin",
    spritePosition: "100% 100%",
  },
} as const satisfies Record<string, PostcardAsset>;