import { useEffect, useRef, useState } from "react";

const COMMAND = "./credits";
const OUTPUT = "COMSKYS'06";
const TYPE_CMD_SPEED = 80;
const TYPE_OUT_SPEED = 100;
const PAUSE_AFTER_CMD = 400;
const HOLD_DURATION = 3000;
const CLEAR_DURATION = 500;
const RESTART_DELAY = 1200;

type Phase =
  | "typing_cmd"
  | "pause"
  | "typing_out"
  | "hold"
  | "clearing"
  | "waiting";

function ComskysTerminal() {
  const [phase, setPhase] = useState<Phase>("typing_cmd");
  const [cmdChars, setCmdChars] = useState(0);
  const [outChars, setOutChars] = useState(0);
  const [clearing, setClearing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (phase === "typing_cmd") {
      if (cmdChars < COMMAND.length) {
        timer.current = setTimeout(() => setCmdChars((c) => c + 1), TYPE_CMD_SPEED);
      } else {
        timer.current = setTimeout(() => setPhase("pause"), PAUSE_AFTER_CMD);
      }
    } else if (phase === "pause") {
      timer.current = setTimeout(() => setPhase("typing_out"), PAUSE_AFTER_CMD);
    } else if (phase === "typing_out") {
      if (outChars < OUTPUT.length) {
        timer.current = setTimeout(() => setOutChars((c) => c + 1), TYPE_OUT_SPEED);
      } else {
        timer.current = setTimeout(() => setPhase("hold"), 200);
      }
    } else if (phase === "hold") {
      timer.current = setTimeout(() => {
        setClearing(true);
        setPhase("clearing");
      }, HOLD_DURATION);
    } else if (phase === "clearing") {
      timer.current = setTimeout(() => {
        setClearing(false);
        setCmdChars(0);
        setOutChars(0);
        setPhase("waiting");
      }, CLEAR_DURATION);
    } else if (phase === "waiting") {
      timer.current = setTimeout(() => setPhase("typing_cmd"), RESTART_DELAY);
    }
  }, [phase, cmdChars, outChars]);

  const [hovered, setHovered] = useState(false);
  const cmdDone = cmdChars >= COMMAND.length;
  const outStarted = phase === "typing_out" || phase === "hold" || phase === "clearing";
  const outDone = outChars >= OUTPUT.length;

  const promptColor = hovered ? "#6ecb73" : "#c8b8a8";
  const textColor = hovered ? "#5a8a5e" : "#c0b0a0";
  const outputColor = hovered ? "#6ecb73" : "#92400E";

  return (
    <div
      aria-label="Developed by Comskys'06"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: "Menlo, Consolas, 'Courier New', monospace",
        fontSize: "12px",
        lineHeight: "1.6",
        background: hovered ? "#0c0e12" : "transparent",
        borderRadius: "6px",
        padding: "8px 14px",
        width: "155px",
        height: "56px",
        boxShadow: hovered
          ? "0 2px 12px rgba(0,0,0,0.25), inset 0 0 40px rgba(110,203,115,0.015)"
          : "none",
        overflow: "hidden",
        position: "relative",
        transition: "background 0.4s ease, box-shadow 0.4s ease",
        cursor: "default",
      }}
    >
      {/* CRT scanline overlay — only when hovered */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: hovered
            ? "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)"
            : "none",
          pointerEvents: "none",
          borderRadius: "6px",
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      />

      <div
        style={{
          transform: clearing ? "translateY(-100%)" : "translateY(0)",
          opacity: clearing ? 0 : 1,
          transition: clearing
            ? `transform ${CLEAR_DURATION}ms ease-in, opacity ${CLEAR_DURATION}ms ease-in`
            : "none",
          position: "relative",
        }}
      >
        {/* Line 1: $ ./credits */}
        <div style={{ whiteSpace: "nowrap", transition: "color 0.4s ease", color: textColor }}>
          <span style={{ color: promptColor, fontWeight: 700, transition: "color 0.4s ease" }}>$</span>{" "}
          <span>{COMMAND.slice(0, cmdChars)}</span>
          {!cmdDone && <Cursor active={hovered} />}
        </div>

        {/* Line 2: COMSKYS'06 */}
        {outStarted && (
          <div
            style={{
              color: outputColor,
              fontWeight: 700,
              letterSpacing: "1.5px",
              textShadow: hovered ? "0 0 8px rgba(110,203,115,0.3)" : "none",
              whiteSpace: "nowrap",
              minHeight: "1.8em",
              transition: "color 0.4s ease, text-shadow 0.4s ease",
            }}
          >
            {OUTPUT.slice(0, outChars)}
            {(!outDone || phase === "hold") && <Cursor active={hovered} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Cursor({ active }: { active: boolean }) {
  const [on, setOn] = useState(true);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => setOn((v) => !v), 530);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, []);

  return (
    <span
      style={{
        display: "inline-block",
        width: "7px",
        height: "13px",
        background: active ? "#6ecb73" : "#c8b8a8",
        verticalAlign: "text-bottom",
        marginLeft: "1px",
        opacity: on ? (active ? 0.9 : 0.5) : 0,
        boxShadow: on && active ? "0 0 4px rgba(110,203,115,0.4)" : "none",
        transition: "background 0.4s ease",
      }}
    />
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-surface border-t border-[rgba(200,180,150,0.18)] py-8 px-5">
      <div className="max-w-[1320px] mx-auto flex items-center justify-between flex-wrap gap-4">
        <p className="font-accent text-[17px] md:text-[22px] text-terracotta tracking-wide m-0 flex-1 text-center md:text-left">
          Reuniting hearts. Reliving memories.{" "}
          <span aria-hidden="true">&#9825;</span>
        </p>
        <div className="shrink-0 hidden md:block">
          <ComskysTerminal />
        </div>
      </div>
      <p className="text-[10px] text-[#c8b8a8] mt-4 text-center">
        &copy; Smriti 2026, The Batch of 2006, TKMCE
        <span className="mx-1.5">&middot;</span>
        <span className="font-mono">{__GIT_HASH__}</span>
      </p>
    </footer>
  );
}
