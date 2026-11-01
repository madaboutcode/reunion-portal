import { SPRITE_SRC } from "@/components/registration/participation-postcards";

export interface PostcardProps {
  label: string;
  spritePosition: string;
  rotation?: number;
  accent?: "tape" | "pin" | "none";
  className?: string;
  showLabel?: boolean;
}

const ACCENT_SRC: Record<"tape" | "pin", string> = {
  tape: "/assets/registration/postcard-ui/tape.svg",
  pin: "/assets/registration/postcard-ui/pin.svg",
};

const ROTATION_CLASS: Record<number, string> = {
  [-8]: "rotate-[-8deg]",
  [-6]: "rotate-[-6deg]",
  [-4]: "rotate-[-4deg]",
  [-3]: "rotate-[-3deg]",
  [-2]: "rotate-[-2deg]",
  0: "",
  2: "rotate-[2deg]",
  3: "rotate-[3deg]",
  4: "rotate-[4deg]",
  5: "rotate-[5deg]",
  6: "rotate-[6deg]",
  8: "rotate-[8deg]",
};

export function Postcard({
  label,
  spritePosition,
  rotation = 0,
  accent = "none",
  className = "",
  showLabel = true,
}: PostcardProps) {
  const rotateClass = ROTATION_CLASS[rotation] ?? "";

  return (
    <figure
      className={["relative block w-full", rotateClass, className]
        .filter(Boolean)
        .join(" ")}
    >
      {accent !== "none" && (
        <img
          src={ACCENT_SRC[accent]}
          alt=""
          aria-hidden
          className={[
            "absolute z-10 pointer-events-none",
            accent === "tape"
              ? "w-[48px] -top-2.5 left-1/2 -translate-x-1/2"
              : "w-5 -top-1.5 left-1/2 -translate-x-1/2",
          ].join(" ")}
        />
      )}
      <div className="bg-white p-1.5 sm:p-2 rounded-lg shadow-[0_2px_10px_rgba(80,60,40,0.12)]">
        <div
          role="img"
          aria-label={label}
          className="w-full aspect-[4/3] rounded-md"
          style={{
            backgroundImage: `image-set(url("${SPRITE_SRC.x1}") 1x, url("${SPRITE_SRC.x2}") 2x)`,
            backgroundSize: "200% 200%",
            backgroundPosition: spritePosition,
          }}
        />
      </div>
      {showLabel && (
        <figcaption className="font-accent text-[13px] sm:text-[14px] text-charcoal text-center mt-1 leading-tight">
          {label}
        </figcaption>
      )}
    </figure>
  );
}
