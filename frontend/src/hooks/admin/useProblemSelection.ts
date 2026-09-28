import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { AdminProblem } from '../../types';

import {
  EMPTY_PROBLEM_SELECTION,
  applyRowSelection,
  computeSelectionAfterToggle,
  pruneSelectionToDisplayed,
  selectDisplayedIds,
} from './problemManagement.helpers';
import type { ProblemSelectionState } from './problemManagement.helpers';

interface UseProblemSelectionArgs {
  /** Rows the table currently DISPLAYS (after search/filter/sort and
   *  whatever has been loaded so far). This — not the full server-side
   *  list — is the source of truth for every selection behavior, so the
   *  hook plugs into future Show More incremental loading unchanged:
   *  newly loaded rows simply start unselected. */
  displayedProblems: AdminProblem[];
}

/** Bulk selection state for the problems table: Set-of-ids + a
 *  Shift+click range anchor + the drag gesture bookkeeping. All state is
 *  replaced (never mutated) so React can rely on identity. */
const useProblemSelection = ({ displayedProblems }: UseProblemSelectionArgs) => {
  const [selection, setSelection] = useState<ProblemSelectionState>(EMPTY_PROBLEM_SELECTION);

  // Keep an always-fresh copy of the displayed rows inside drag handlers:
  // they run outside the render cycle (window listeners) and must see the
  // current display order, not the one captured when the drag began.
  const displayedProblemsRef = useRef(displayedProblems);
  displayedProblemsRef.current = displayedProblems;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /** Drop selected ids that fell out of the display (deleted rows, data
   *  refreshes). Idempotent — a no-op when every selection is still
   *  visible, which keeps Show More row appends non-destructive. */
  useEffect(() => {
    setSelection((prev) => pruneSelectionToDisplayed(prev, displayedProblems));
  }, [displayedProblems]);

  /** Clear the selection entirely (e.g. when the user changes a filter and
   *  the previously selected rows may no longer be visible). */
  const clearSelection = useCallback(() => {
    setSelection(EMPTY_PROBLEM_SELECTION);
  }, []);

  const selectedProblemIds = useMemo(
    () => [...selection.ids],
    [selection],
  );

  // --- Row activation ------------------------------------------------------

  /** Checkbox onChange: plain click toggles one row and moves the anchor;
   *  Shift+click selects/deselects the anchor..row range in display order. */
  const handleToggleSelectProblem = useCallback(
    (problemId: string, { shiftKey = false }: { shiftKey?: boolean } = {}) => {
      setSelection((prev) =>
        computeSelectionAfterToggle(prev, displayedProblemsRef.current, problemId, { shiftKey }),
      );
    },
    [],
  );

  /** Header checkbox: "every displayed row" — checked when all displayed
   *  rows are selected, unchecked clears them all. Frontend state only. */
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelection((prev) =>
        selectDisplayedIds(
          prev,
          displayedProblemsRef.current.map((problem) => problem.id),
          checked,
        ),
      );
    },
    [],
  );

  // --- Header tri-state ----------------------------------------------------

  const headerChecked = useMemo(() => {
    return displayedProblems.length > 0 && displayedProblems.every((p) => selection.ids.has(p.id));
  }, [displayedProblems, selection]);

  const headerIndeterminate = useMemo(() => {
    return !headerChecked && displayedProblems.some((p) => selection.ids.has(p.id));
  }, [displayedProblems, headerChecked, selection]);

  /** Sets the DOM indeterminate property on the header checkbox — the
   *  visual `[-]` state that a controlled React checkbox can't express. */
  const bindHeaderCheckboxRef = useCallback((element: HTMLInputElement | null) => {
    if (element) {
      element.indeterminate = headerIndeterminate;
    }
  }, [headerIndeterminate]);

  // --- Drag-to-select ------------------------------------------------------

  const [dragState, setDragState] = useState<{
    /** true = dragging SELECTS rows, false = dragging deselects. Decided by
     *  the state of the row the gesture started on. */
    targetState: boolean;
    visitedIds: ReadonlySet<string>;
  } | null>(null);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  /** Rows enter the gesture as the pointer passes over them. The active
   *  drag's feedback tint is driven by `dragState.visitedIds`. */
  const handleDragOverRow = useCallback((problemId: string) => {
    const drag = dragStateRef.current;
    if (!drag || drag.visitedIds.has(problemId)) {
      return;
    }
    dragStateRef.current = {
      ...drag,
      visitedIds: new Set([...drag.visitedIds, problemId]),
    };
    setDragState(dragStateRef.current);
    setSelection((prev) => applyRowSelection(prev, problemId, drag.targetState, null));
  }, []);

  /** pointerdown on a row's selection zone starts the gesture. The zone is
   *  the checkbox's own cell (see ProblemManagement.tsx) — never the row's
   *  buttons, links, badges, or text. */
  const endDragRef = useRef<(() => void) | null>(null);

  const handleSelectionZonePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, problemId: string, isSelected: boolean) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const initialDrag = { targetState: !isSelected, visitedIds: new Set<string>([problemId]) };
      dragStateRef.current = initialDrag;
      setDragState(initialDrag);
      setSelection((prev) => applyRowSelection(prev, problemId, initialDrag.targetState, problemId));

      const endDrag = () => {
        dragStateRef.current = null;
        setDragState(null);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        endDragRef.current = null;
      };
      endDragRef.current = endDrag;
      // Window-level listeners (not pointer capture): the checkbox stays
      // hoverable while the pointer roams outside the table, and both
      // normal and canceled gestures always clear the dragging state.
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    },
    [],
  );

  const isDragging = dragState !== null;
  const isRowVisited = useCallback(
    (problemId: string) => dragState?.visitedIds.has(problemId) ?? false,
    [dragState],
  );

  // Safety net: if the component unmounts mid-gesture, drop the window
  // listeners so nothing stays subscribed to a dead page.
  useEffect(() => {
    return () => {
      endDragRef.current?.();
    };
  }, []);

  const isProblemSelected = useCallback(
    (problemId: string) => selection.ids.has(problemId),
    [selection],
  );

  return {
    selection,
    selectedProblemIds,
    selectedCount: selection.ids.size,
    isProblemSelected,
    hasSelection: selection.ids.size > 0,
    headerChecked,
    headerIndeterminate,
    bindHeaderCheckboxRef,
    handleToggleSelectProblem,
    handleSelectAll,
    clearSelection,
    isDragging,
    isRowVisited,
    handleDragOverRow,
    handleSelectionZonePointerDown,
  };
};

export default useProblemSelection;
