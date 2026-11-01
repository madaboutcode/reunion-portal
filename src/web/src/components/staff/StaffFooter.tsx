export function StaffFooter() {
  return (
    <footer className="border-t border-[rgba(200,180,150,0.18)]">
      <div className="max-w-[1320px] mx-auto px-5 py-4">
        <p className="text-[10px] text-[#c8b8a8] text-center">
          &copy; Smriti 2026, The Batch of 2006, TKMCE
          <span className="mx-1.5">&middot;</span>
          <span className="font-mono">{__GIT_HASH__}</span>
        </p>
      </div>
    </footer>
  );
}
