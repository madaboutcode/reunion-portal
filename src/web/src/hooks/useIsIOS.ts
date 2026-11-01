export function useIsIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPad Safari reports as Mac with touch support
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}
