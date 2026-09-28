import { act, renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';

import useProblemSelection from '../../../hooks/admin/useProblemSelection';
import type { AdminProblem } from '../../../types';

const makeProblems = (ids: string[]): AdminProblem[] =>
  ids.map(id => ({
    id,
    title: `Problem ${id}`,
    author: 'admin',
    collection_id: null,
    collection_name: null,
    is_visible: true,
    contest_id: null,
    contest_status: null,
  }));

/** react-hooks test double for a checkbox cell's pointer gesture. */
const pointerDownOnZone = (
  result: { current: ReturnType<typeof useProblemSelection> },
  problemId: string,
  isSelected: boolean,
) => {
  const handler = result.current.handleSelectionZonePointerDown;
  // Minimal React pointer event stand-in: only the fields the hook reads.
  const event = {
    button: 0,
    preventDefault: jest.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
  act(() => {
    handler(event, problemId, isSelected);
  });
};

describe('useProblemSelection', () => {
  it('plain click toggles a row; header reflects checked only when all displayed rows are selected', () => {
    const problems = makeProblems(['P1', 'P2', 'P3']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    expect(result.current.headerChecked).toBe(false);
    expect(result.current.headerIndeterminate).toBe(false);

    act(() => result.current.handleToggleSelectProblem('P1'));
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.headerChecked).toBe(false);
    expect(result.current.headerIndeterminate).toBe(true);

    act(() => result.current.handleToggleSelectProblem('P2'));
    act(() => result.current.handleToggleSelectProblem('P3'));
    expect(result.current.headerChecked).toBe(true);
    expect(result.current.headerIndeterminate).toBe(false);
    expect(result.current.selectedProblemIds).toEqual(['P1', 'P2', 'P3']);
  });

  it('header select-all uses only the DISPLAYED rows, not all rows in the system', () => {
    // Six displayed rows (a filter is narrowing a larger system down to 6).
    const displayed = makeProblems(['01_e1', '01_e2', '01_e3', '01_e4', '01_e5', '01_e6']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: displayed }));

    act(() => result.current.handleSelectAll(true));
    expect(result.current.selectedProblemIds.sort()).toEqual(
      ['01_e1', '01_e2', '01_e3', '01_e4', '01_e5', '01_e6'],
    );
    expect(result.current.selectedCount).toBe(6);
    expect(result.current.headerChecked).toBe(true);
  });

  it('header select-all from an empty display yields an empty selection', () => {
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: [] }));
    act(() => result.current.handleSelectAll(true));
    expect(result.current.selectedCount).toBe(0);
  });

  it('header deselect-all removes every displayed row selection', () => {
    const problems = makeProblems(['P1', 'P2']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));
    act(() => result.current.handleSelectAll(true));
    act(() => result.current.handleSelectAll(false));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.hasSelection).toBe(false);
  });

  it('Shift+click selects the display-order range between anchor and target', () => {
    const problems = makeProblems(['R1', 'R2', 'R3', 'R4']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    act(() => result.current.handleToggleSelectProblem('R2'));
    act(() => result.current.handleToggleSelectProblem('R4', { shiftKey: true }));
    expect(result.current.selectedProblemIds.sort()).toEqual(['R2', 'R3', 'R4']);

    // Upward range too.
    act(() => result.current.handleToggleSelectProblem('R1', { shiftKey: true }));
    expect(result.current.selectedProblemIds.sort()).toEqual(['R1', 'R2', 'R3', 'R4']);
  });

  it('drag gesture: pointerdown selects the start row; rows dragged over join the gesture', () => {
    const problems = makeProblems(['D1', 'D2', 'D3']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    pointerDownOnZone(result, 'D1', false);
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isDragging).toBe(true);

    act(() => result.current.handleDragOverRow('D2'));
    act(() => result.current.handleDragOverRow('D3'));
    expect(result.current.selectedProblemIds).toEqual(['D1', 'D2', 'D3']);
    expect(result.current.isRowVisited('D2')).toBe(true);

    // pointerup ends the gesture and clears the visited-row feedback.
    act(() => {
      fireEvent(window, new Event('pointerup'));
    });
    expect(result.current.isDragging).toBe(false);
    expect(result.current.isRowVisited('D2')).toBe(false);
    expect(result.current.selectedCount).toBe(3); // selection itself persists
  });

  it('drag gesture starting on a selected row deselects every row it sweeps', () => {
    const problems = makeProblems(['D1', 'D2', 'D3']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    act(() => result.current.handleSelectAll(true));
    pointerDownOnZone(result, 'D1', true); // starting row is selected → deselect gesture
    act(() => result.current.handleDragOverRow('D2'));
    act(() => result.current.handleDragOverRow('D3'));

    expect(result.current.selectedCount).toBe(0);
    act(() => {
      fireEvent(window, new Event('pointerup'));
    });
  });

  it('ignores pointerdown with a non-primary button', () => {
    const problems = makeProblems(['P1']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    const event = { button: 2, preventDefault: jest.fn() } as unknown as React.PointerEvent<HTMLElement>;
    act(() => result.current.handleSelectionZonePointerDown(event, 'P1', false));
    expect(result.current.isDragging).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('pointercancel ends the gesture and cleans up listeners (no stuck dragging)', () => {
    const problems = makeProblems(['P1', 'P2']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    pointerDownOnZone(result, 'P1', false);
    expect(result.current.isDragging).toBe(true);

    act(() => {
      fireEvent(window, new Event('pointercancel'));
    });
    expect(result.current.isDragging).toBe(false);

    // The window listeners must be gone: firing pointerup again must be inert.
    const before = result.current.selectedCount;
    act(() => {
      fireEvent(window, new Event('pointerup'));
    });
    expect(result.current.selectedCount).toBe(before);
  });

  it('dragging over the same row twice applies it only once', () => {
    const problems = makeProblems(['P1', 'P2']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    pointerDownOnZone(result, 'P1', false); // select gesture
    act(() => result.current.handleDragOverRow('P2'));
    act(() => result.current.handleDragOverRow('P2')); // duplicate — ignored
    expect(result.current.selectedProblemIds).toEqual(['P1', 'P2']);

    act(() => {
      fireEvent(window, new Event('pointerup'));
    });
  });

  describe('Show More compatibility (displayed rows grow incrementally)', () => {
    it('newly loaded rows start unselected; the header goes indeterminate; clicking it selects everything displayed', () => {
      const initial = makeProblems(['L1', 'L2']);
      const { result, rerender } = renderHook(
        ({ problems }) => useProblemSelection({ displayedProblems: problems }),
        { initialProps: { problems: initial } },
      );

      act(() => result.current.handleSelectAll(true));
      expect(result.current.headerChecked).toBe(true);

      // Show More appends rows: same first two plus L3, L4.
      rerender({ problems: makeProblems(['L1', 'L2', 'L3', 'L4']) });

      // Existing selection intact, new rows unselected, header recalculated.
      expect(result.current.isProblemSelected('L1')).toBe(true);
      expect(result.current.isProblemSelected('L2')).toBe(true);
      expect(result.current.isProblemSelected('L3')).toBe(false);
      expect(result.current.isProblemSelected('L4')).toBe(false);
      expect(result.current.headerChecked).toBe(false);
      expect(result.current.headerIndeterminate).toBe(true);

      // Clicking the header again selects all four displayed rows.
      act(() => result.current.handleSelectAll(true));
      expect(result.current.selectedCount).toBe(4);
      expect(result.current.headerChecked).toBe(true);
    });

    it('rows that disappear from the display get pruned (deleted problems, refreshes)', () => {
      const initial = makeProblems(['L1', 'L2', 'L3']);
      const { result, rerender } = renderHook(
        ({ problems }) => useProblemSelection({ displayedProblems: problems }),
        { initialProps: { problems: initial } },
      );

      act(() => result.current.handleSelectAll(true));
      rerender({ problems: makeProblems(['L1', 'L3']) }); // L2 deleted

      expect(result.current.selectedProblemIds.sort()).toEqual(['L1', 'L3']);
    });
  });

  it('unmounting mid-gesture removes the window listeners', () => {
    const problems = makeProblems(['P1']);
    const { result, unmount } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    pointerDownOnZone(result, 'P1', false);
    expect(result.current.isDragging).toBe(true);

    const removeSpy = jest.spyOn(window, 'removeEventListener');
    unmount();

    // The unmount cleanup ran endDrag, which removed both listeners.
    const removedTypes = removeSpy.mock.calls.map(call => call[0]);
    expect(removedTypes).toContain('pointerup');
    expect(removedTypes).toContain('pointercancel');
    removeSpy.mockRestore();
  });

  it('clearSelection empties the selection and the anchor', () => {
    const problems = makeProblems(['P1', 'P2', 'P3']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));

    act(() => result.current.handleToggleSelectProblem('P2'));
    act(() => result.current.clearSelection());
    expect(result.current.selectedCount).toBe(0);

    // No anchor remains: a subsequent Shift+click degrades to a plain toggle.
    act(() => result.current.handleToggleSelectProblem('P3', { shiftKey: true }));
    expect(result.current.selectedProblemIds).toEqual(['P3']);
  });

  it('renders with zero displayed rows without selecting anything', () => {
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: [] }));
    expect(result.current.hasSelection).toBe(false);
    expect(result.current.headerChecked).toBe(false);
    expect(result.current.selectedProblemIds).toEqual([]);
  });

  it('renders with a single displayed row and selects it via the header', () => {
    const problems = makeProblems(['ONLY']);
    const { result } = renderHook(() => useProblemSelection({ displayedProblems: problems }));
    act(() => result.current.handleSelectAll(true));
    expect(result.current.selectedProblemIds).toEqual(['ONLY']);
    expect(result.current.headerChecked).toBe(true);
    expect(result.current.headerIndeterminate).toBe(false);
  });
});
