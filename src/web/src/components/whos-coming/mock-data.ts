import type { PublicAttendee } from "@/lib/api";

/** Short branch keys from the approved HTML prototype → full DB branch names. */
const BRANCH_BY_KEY: Record<string, PublicAttendee["branch"]> = {
  Electrical: "Electrical & Electronics Engineering",
  Civil: "Civil Engineering",
  Production: "Production Engineering",
  "Computer Science": "Computer Science & Engineering",
  Mechanical: "Mechanical Engineering",
  Electronics: "Electronics & Communication Engineering",
  Chemical: "Chemical Engineering",
  Architecture: "Architecture",
};

interface MockRow {
  name: string;
  branch: string;
  city: string;
  country: string;
  hasPhoto?: boolean;
}

const ROWS: MockRow[] = [
  { name: "Asha Example", branch: "Electrical", city: "Aluva, Ernakulam", country: "India" },
  { name: "Ben Sample", branch: "Electrical", city: "Manchester", country: "UK" },
  { name: "Chitra Demo", branch: "Electrical", city: "Ernakulam", country: "India" },
  { name: "Dev Test", branch: "Electrical", city: "Bangalore", country: "India" },
  { name: "Esha Mock", branch: "Electrical", city: "Cochin", country: "India" },
  { name: "Farid Placeholder", branch: "Electrical", city: "London", country: "UK" },
  { name: "Gita Fixture", branch: "Electrical", city: "Trivandrum", country: "India" },
  { name: "Hari Specimen", branch: "Electrical", city: "Doha", country: "Qatar" },
  { name: "Indu Dummy", branch: "Electrical", city: "Bangalore", country: "India" },
  { name: "Jai Synthetic", branch: "Electrical", city: "Bangalore", country: "India" },
  { name: "Kiran Example", branch: "Electrical", city: "Bangalore", country: "India" },
  { name: "Lena Sample", branch: "Electrical", city: "Singapore", country: "Singapore" },
  { name: "Manu Demo", branch: "Electrical", city: "Chennai", country: "India" },
  { name: "Nila Test", branch: "Electrical", city: "Ernakulam", country: "India" },
  { name: "Omar Mock", branch: "Electrical", city: "Sydney", country: "Australia" },
  { name: "Priya Placeholder", branch: "Electrical", city: "Trivandrum", country: "India" },
  { name: "Quin Fixture", branch: "Electrical", city: "Trivandrum", country: "India" },
  { name: "Ravi Specimen", branch: "Electrical", city: "Kochi", country: "India" },
  { name: "Sana Dummy", branch: "Electrical", city: "Bangalore", country: "India" },
  { name: "Tara Synthetic", branch: "Civil", city: "Abu Dhabi", country: "UAE" },
  { name: "Uma Example", branch: "Civil", city: "Bangalore", country: "India" },
  { name: "Vik Sample", branch: "Civil", city: "Trivandrum", country: "India" },
  { name: "Wren Demo", branch: "Civil", city: "Dubai", country: "UAE" },
  { name: "Xena Test", branch: "Civil", city: "Brisbane", country: "Australia" },
  { name: "Yash Mock", branch: "Civil", city: "Melbourne", country: "Australia" },
  { name: "Zoya Placeholder", branch: "Civil", city: "Sharjah", country: "UAE" },
  { name: "Anil Fixture", branch: "Civil", city: "Thiruvananthapuram", country: "India" },
  { name: "Bela Specimen", branch: "Civil", city: "Dubai", country: "UAE" },
  { name: "Cyril Dummy", branch: "Civil", city: "Atlanta", country: "USA" },
  { name: "Dipa Synthetic", branch: "Civil", city: "Dubai", country: "UAE" },
  { name: "Eshan Example", branch: "Civil", city: "Pune", country: "India" },
  { name: "Fiona Sample", branch: "Production", city: "Trivandrum", country: "India" },
  { name: "Gopal Demo", branch: "Production", city: "Kuwait City", country: "Kuwait" },
  { name: "Hema Test", branch: "Production", city: "Bangalore", country: "India" },
  { name: "Ivan Mock", branch: "Production", city: "Mumbai", country: "India" },
  { name: "Juhi Placeholder", branch: "Production", city: "Abu Dhabi", country: "UAE" },
  { name: "Karan Fixture", branch: "Production", city: "Pune", country: "India" },
  { name: "Leela Specimen", branch: "Computer Science", city: "Seattle", country: "USA" },
  { name: "Mira Dummy", branch: "Computer Science", city: "Kollam", country: "India" },
  { name: "Nikhil Synthetic", branch: "Computer Science", city: "Charlotte", country: "USA" },
  { name: "Opal Example", branch: "Computer Science", city: "San Francisco", country: "USA" },
  { name: "Pranav Sample", branch: "Computer Science", city: "Dubai", country: "UAE" },
  { name: "Rhea Demo", branch: "Mechanical", city: "London", country: "UK" },
  { name: "Sunil Test", branch: "Mechanical", city: "Brisbane", country: "Australia" },
  { name: "Tina Mock", branch: "Mechanical", city: "Dubai", country: "UAE" },
  { name: "Usha Placeholder", branch: "Mechanical", city: "Dammam", country: "Saudi Arabia" },
  { name: "Vimal Fixture", branch: "Electronics", city: "Trivandrum", country: "India" },
  { name: "Wali Specimen", branch: "Electronics", city: "Doha", country: "Qatar" },
  { name: "Yara Dummy", branch: "Chemical", city: "Kuwait City", country: "Kuwait" },
  { name: "Zane Synthetic", branch: "Chemical", city: "Bengaluru", country: "India" },
  { name: "Aarav Example", branch: "Architecture", city: "Thrissur", country: "India" },
  { name: "Bina Sample", branch: "Architecture", city: "Kottayam", country: "India" },
];

/** Indices that show initials fallback instead of a placeholder photo. */
const NO_PHOTO_INDICES = new Set([4, 17, 33, 48]);

/** Fake registration timestamps, spaced a day apart, oldest first (row order = signup order). */
const MOCK_BASE_CREATED_AT = 1748736000000; // 2026-06-01T00:00:00Z
const MOCK_DAY_MS = 24 * 60 * 60 * 1000;

export const MOCK_WHOS_COMING_PEOPLE: PublicAttendee[] = ROWS.map((row, index) => ({
  id: 1001 + index,
  fullName: row.name,
  branch: BRANCH_BY_KEY[row.branch] ?? row.branch,
  city: row.city,
  country: row.country,
  hasPhoto: row.hasPhoto ?? !NO_PHOTO_INDICES.has(index),
  createdAt: MOCK_BASE_CREATED_AT + index * MOCK_DAY_MS,
}));