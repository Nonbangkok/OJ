const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "Nov 16 13:00 – 16:00", or both dates when the window crosses midnight. */
export const formatWindow = (start: string, end: string): string => {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  return `${DAY.format(s)} ${TIME.format(s)} – ${sameDay ? '' : `${DAY.format(e)} `}${TIME.format(e)}`;
};

/** "13:00 – 16:00". */
export const formatTimeRange = (start: string, end: string): string =>
  `${TIME.format(new Date(start))} – ${TIME.format(new Date(end))}`;

/** "2 h", "1 h 30 min", "45 min". */
export const formatDuration = (startIso: string, endIso: string): string => {
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
