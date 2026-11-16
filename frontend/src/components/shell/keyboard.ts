/** True when a key press should be left to the focused field (typing, code editors). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor, [data-code-editor]')) return true;
  return false;
}

/** True while a modal dialog (ours or a page's) is open. */
export function isModalOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]'));
}
