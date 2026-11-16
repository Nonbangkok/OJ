/**
 * Keyboard shortcut labels. Handlers accept both ⌘ and Ctrl; the label shows
 * the one this platform uses: ⌘K on macOS / iOS, Ctrl+K everywhere else.
 * Read at render time (not once at import), so it always matches the browser.
 */
export const isApplePlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const modifierLabel = (): string => (isApplePlatform() ? '⌘' : 'Ctrl');

/** '⌘K' on Apple, 'Ctrl+K' elsewhere. */
export const shortcutLabel = (key: string): string => (isApplePlatform() ? `⌘${key}` : `Ctrl+${key}`);
