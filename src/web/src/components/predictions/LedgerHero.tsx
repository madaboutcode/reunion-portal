export function LedgerHero() {
  return (
    <section className="leaderboard-hero-shell relative overflow-hidden">
      <div className="leaderboard-hero-atmosphere pointer-events-none absolute inset-0" />
      <div className="absolute inset-0 bg-[url('/assets/leaderboard/prediction-contest-hero.png')] bg-cover bg-center bg-no-repeat opacity-50 [mask-image:linear-gradient(to_bottom,transparent,#000_40%)] md:left-auto md:right-0 md:w-[60%] md:bg-[center_right] md:opacity-100 md:[mask-image:linear-gradient(to_right,transparent_0%,#000_26%,#000_100%)]" />
      <div className="leaderboard-hero-lights pointer-events-none absolute inset-y-0 right-0 hidden w-[62%] md:block" />
      <div className="leaderboard-sparkle-field pointer-events-none absolute inset-0 opacity-80" />

      <div className="mx-auto max-w-[1120px] px-5 md:px-7">
        <div className="relative flex min-h-[460px] items-center md:min-h-[500px]">
          <div className="relative z-[2] w-full py-10 md:w-[54%]">
            <h1 className="font-heading text-[clamp(46px,6vw,76px)] leading-[0.96] font-extrabold tracking-[-0.015em]">
              <span className="block text-[#0a1628]">THE</span>
              <span className="block text-[#e8722a]">LEDGER</span>
            </h1>

            <p className="mt-3 font-accent text-[30px] font-semibold text-[#e8722a]">
              every point tells a story
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
