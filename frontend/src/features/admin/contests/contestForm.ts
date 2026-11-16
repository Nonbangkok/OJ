import type { Contest } from '../../../types';
import { bangkokParts, bangkokToMs, isValidTime } from './bangkokTime';

export type DurationPreset = '1' | '2' | '3' | '5' | 'custom';
export const DURATION_PRESETS: Array<{ value: DurationPreset; label: string }> = [
  { value: '1', label: '1 h' }, { value: '2', label: '2 h' }, { value: '3', label: '3 h' }, { value: '5', label: '5 h' }, { value: 'custom', label: 'Custom' },
];
const HOUR_MS = 3_600_000;

export interface ContestFormState {
  title: string;
  description: string;
  date: string;
  time: string;
  preset: DurationPreset;
  hours: string;
  minutes: string;
  visible: boolean;
}

export type ContestFormErrors = Partial<Record<'title' | 'date' | 'time' | 'duration' | 'form', string>>;

/** New contest: tomorrow 09:00 Bangkok, 2 h, visible. */
export const newContestForm = (): ContestFormState => ({
  title: '', description: '', date: bangkokParts(Date.now() + 24 * HOUR_MS).date, time: '09:00', preset: '2', hours: '2', minutes: '0', visible: true,
});

export const formFromContest = (contest: Contest): ContestFormState => {
  const start = Date.parse(contest.start_time);
  const minutes = Math.max(1, Math.round((Date.parse(contest.end_time) - start) / 60000));
  const preset = (['1', '2', '3', '5'] as const).find((h) => Number(h) * 60 === minutes) ?? 'custom';
  const { date, time } = bangkokParts(start);
  return {
    title: contest.title, description: contest.description ?? '', date, time, preset,
    hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60), visible: Boolean(contest.is_visible),
  };
};

export const durationMsOf = (form: ContestFormState) => (form.preset === 'custom'
  ? (Number(form.hours) || 0) * HOUR_MS + (Number(form.minutes) || 0) * 60_000
  : Number(form.preset) * HOUR_MS);

/** Start and end in epoch ms, or nulls while the inputs don't parse. */
export const windowOf = (form: ContestFormState) => {
  const startMs = bangkokToMs(form.date, form.time);
  const duration = durationMsOf(form);
  return { startMs, endMs: startMs !== null && duration > 0 ? startMs + duration : null };
};

export const validateContestForm = (form: ContestFormState, { requireFuture }: { requireFuture: boolean }): ContestFormErrors => {
  const errors: ContestFormErrors = {};
  const { startMs } = windowOf(form);
  if (!form.title.trim()) errors.title = 'Title is required.';
  if (!isValidTime(form.time)) errors.time = 'Use 24-hour time, e.g. 19:00.';
  else if (startMs === null) errors.date = 'Pick a start date.';
  else if (requireFuture && startMs <= Date.now()) errors.date = 'Start must be in the future.';
  const h = Number(form.hours);
  const m = Number(form.minutes);
  const customOk = form.preset !== 'custom' || (Number.isInteger(h) && Number.isInteger(m) && h >= 0 && m >= 0 && m < 60);
  if (!customOk || durationMsOf(form) <= 0) errors.duration = 'Duration must be at least one minute (whole hours and minutes).';
  return errors;
};

/** The create/update body: Bangkok wall-clock times as ISO instants. */
export const contestPayload = (form: ContestFormState) => {
  const { startMs, endMs } = windowOf(form);
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    startTime: new Date(startMs as number).toISOString(),
    endTime: new Date(endMs as number).toISOString(),
  };
};
