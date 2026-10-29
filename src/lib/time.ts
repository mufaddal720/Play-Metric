/** All user-visible dates and times are shown in UAE local time (Asia/Dubai, UTC+4, no DST). */
export const UAE_TIMEZONE = 'Asia/Dubai';

export function formatUaeDateTime(iso: string | number | Date, locale = 'en-AE'): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    timeZone: UAE_TIMEZONE,
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) + ' GST';
}

export function formatUaeTime(iso: string | number | Date, locale = 'en-AE'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: UAE_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/** mm:ss for match clocks and media timestamps. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
