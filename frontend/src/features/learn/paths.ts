/** Learn URLs (spec §7). */
export const LEARN_PATH = '/learn';
export const trackPath = (trackSlug: string): string => `${LEARN_PATH}/${encodeURIComponent(trackSlug)}`;
export const lessonPath = (trackSlug: string, lessonSlug: string): string =>
  `${trackPath(trackSlug)}/${encodeURIComponent(lessonSlug)}`;
