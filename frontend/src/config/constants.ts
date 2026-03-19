/**
 * Frontend Constants
 */

export const POLLING_INTERVALS: Record<string, number> = {
    CONTEST_GUARD: 15000,
    SCOREBOARD: 30000,
    SUBMISSIONS: 2500,
    BATCH_PROCESS: 2000,
};

export const UI_TIMEOUTS: Record<string, number> = {
    SUCCESS_MESSAGE_SHORT: 3000,
    SUCCESS_MESSAGE_LONG: 5000,
    COPY_CLIPBOARD: 2000,
    MODAL_CHECK: 50,
};

export const UI_CONFIG: Record<string, number> = {
    DEFAULT_EDITOR_FONT_SIZE: 16,
};
