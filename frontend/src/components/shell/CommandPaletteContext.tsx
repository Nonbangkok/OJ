import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import CommandPalette from './CommandPalette';
import { isEditableTarget, isModalOpen } from './keyboard';

interface CommandPaletteValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const noop = () => undefined;
const CommandPaletteContext = createContext<CommandPaletteValue>({ open: noop, close: noop, isOpen: false });

export const useCommandPalette = (): CommandPaletteValue => useContext(CommandPaletteContext);

/** Owns the ⌘K palette: global shortcuts and the open state. Must sit inside the router. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never stack the palette on top of another modal (two focus traps).
      if (isModalOpen()) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen(true);
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableTarget(event.target)) {
        event.preventDefault();
        setIsOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {isOpen && <CommandPalette onClose={close} />}
    </CommandPaletteContext.Provider>
  );
}
