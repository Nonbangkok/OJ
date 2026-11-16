/**
 * Contest times are entered and shown in Asia/Bangkok (UTC+7, no DST) — the
 * scheduler's timezone — whatever the admin's browser is set to.
 */
export const BANGKOK_TZ = 'Asia/Bangkok';
export const BANGKOK_NOTE = 'Times are Asia/Bangkok (UTC+7)';
const OFFSET_MS = 7 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const isValidTime = (time: string) => TIME_RE.test(time.trim());

/** `2026-11-27` + `19:00` (Bangkok) → epoch ms, or null when either is malformed. */
export function bangkokToMs(date: string, time: string): number | null {
  const d = DATE_RE.exec(date.trim());
  const t = TIME_RE.exec(time.trim());
  if (!d || !t) return null;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])) - OFFSET_MS;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Bangkok `{ date: 'YYYY-MM-DD', time: 'HH:MM' }` for an instant. */
export function bangkokParts(ms: number): { date: string; time: string } {
  const shifted = new Date(ms + OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

const startFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: BANGKOK_TZ,
});
const endFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: BANGKOK_TZ,
});

/** "27 Nov 2026, 19:00" */
export const formatBangkokStart = (value: string | number) => startFormat.format(new Date(value));
/** "Fri 27 Nov, 21:00" */
export const formatBangkokEnd = (value: string | number) => endFormat.format(new Date(value));

/** "2 h", "3 h 30 m", "45 m", "2 d 4 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [d && `${d} d`, h && `${h} h`, m && `${m} m`].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '0 m';
}

/** Every 15 minutes of the day, for the start-time suggestions. */
export const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
