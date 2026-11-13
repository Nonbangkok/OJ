import type { KeyboardEvent } from 'react';

/**
 * Stops react-simple-code-editor from applying its own edits to a read-only
 * textarea. The browser already ignores typing there, but the library
 * handles Enter (auto-indent), bracket pairs, Backspace and undo/redo itself
 * and writes the result into the textarea, so those keys are cancelled before
 * it sees them. Navigation, selection, copy and browser shortcuts still work.
 */
export const preventCodeEdits = (event: KeyboardEvent<HTMLElement>): void => {
  if (event.ctrlKey || event.metaKey) {
    // Undo / redo / tab-capture toggle; leave copy, select-all, find, etc.
    if (/^[zym]$/i.test(event.key)) event.preventDefault();
    return;
  }
  const isEditKey = event.key.length === 1
    || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete';
  if (isEditKey) event.preventDefault();
};

/**
 * Props for a code view the user can scroll, select and copy but not edit.
 * Use readOnly rather than disabled: Gecko browsers (Firefox, Zen, …) do not
 * let users interact with a disabled textarea, so its code cannot be
 * scrolled there. ignoreTabKey keeps Tab moving focus instead of indenting.
 */
export const readOnlyCodeEditorProps = {
  readOnly: true,
  ignoreTabKey: true,
  onKeyDown: preventCodeEdits,
} as const;
