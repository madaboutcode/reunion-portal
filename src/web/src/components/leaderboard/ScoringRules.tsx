import { Link } from "react-router-dom";
import { SoccerBall } from "./SoccerBall";

export function ScoringRules() {
  return (
    <div className="mx-auto mt-7 mb-2 max-w-[1120px] px-5 md:px-7">
      <div className="championship-rules-card grid grid-cols-1 items-center gap-6 rounded-[20px] p-[26px_30px] min-[921px]:grid-cols-[1.05fr_0.95fr_auto]">
        <div className="order-2 min-[921px]:order-none">
          <h3 className="mb-3.5 flex items-center gap-2.5 whitespace-nowrap font-heading text-xl font-extrabold tracking-[0.04em] text-[#e8722a] uppercase">
            <svg
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7 4h10v4a5 5 0 01-10 0z" />
              <path d="M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M9 14h6M10 18h4M12 14v4" />
            </svg>
            How Scoring Works?
          </h3>

          <div className="mb-3 flex gap-3">
            <SoccerBall className="mt-0.5 h-[22px] w-[22px] shrink-0" />
            <a
              href="https://example.com/REPLACE_WITH_SCORING_RULES.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="group/link flex items-center gap-1.5 text-[14.5px] leading-normal font-semibold text-[#0a1628] no-underline transition-colors hover:text-[#e8722a]"
            >
              Scoring Rules
              <span className="text-[#e8722a] transition-transform duration-150 group-hover/link:translate-x-0.5">
                →
              </span>
            </a>
          </div>

          <div className="flex gap-3">
            <svg
              className="mt-0.5 h-[22px] w-[22px] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#e8722a"
              strokeWidth="1.6"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="12" cy="12" r="1" fill="#e8722a" />
            </svg>
            <a
              href="https://example.com/REPLACE_WITH_JOKER_GUIDE.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="group/link flex items-center gap-1.5 text-[14.5px] leading-normal font-semibold text-[#0a1628] no-underline transition-colors hover:text-[#e8722a]"
            >
              Joker Guide
              <span className="text-[#e8722a] transition-transform duration-150 group-hover/link:translate-x-0.5">
                →
              </span>
            </a>
          </div>

        </div>

        <div className="order-1 flex h-[150px] items-center justify-center min-[921px]:order-none">
          <img
            src="/assets/leaderboard/scoring-illustration.png"
            alt=""
            className="max-h-[150px] max-w-full object-contain drop-shadow-[0_16px_20px_rgba(98,62,18,0.18)]"
          />
        </div>

        <div className="order-3 flex flex-col items-stretch gap-3 self-center min-[921px]:order-none">
          <a
            href="https://script.google.com/macros/s/REPLACE_WITH_APPS_SCRIPT_DEPLOYMENT_ID/exec"
            target="_blank"
            rel="noopener noreferrer"
            className="championship-cta group inline-flex items-center justify-center gap-3 rounded-full px-[26px] py-4 font-bold no-underline transition-[background,color,transform,box-shadow] duration-150 hover:-translate-y-px"
          >
            <svg
              className="h-[22px] w-[22px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
            </svg>
            Make Your Next Prediction
            <span className="transition-transform duration-150 group-hover:translate-x-1">
              →
            </span>
          </a>
          <Link
            to="/predictions"
            className="championship-cta group inline-flex items-center justify-center gap-3 rounded-full px-[26px] py-4 font-bold no-underline transition-[background,color,transform,box-shadow] duration-150 hover:-translate-y-px"
          >
            <svg
              className="h-[22px] w-[22px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 7.5h16M4 12h16M4 16.5h10" />
              <circle cx="18" cy="16.5" r="2.5" />
            </svg>
            See who picked what
            <span className="transition-transform duration-150 group-hover:translate-x-1">
              →
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
