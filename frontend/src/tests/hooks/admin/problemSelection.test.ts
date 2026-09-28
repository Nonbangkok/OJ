import {
  EMPTY_PROBLEM_SELECTION,
  applyRowSelection,
  computeSelectionAfterToggle,
  pruneSelectionToDisplayed,
  selectDisplayedIds,
} from '../../../hooks/admin/problemManagement.helpers';
import type { AdminProblem } from '../../../types';

/** Build displayed rows for selection tests. IDs like 'P1'..'Pn' in the
 *  given order — the display order is what range selection must honor. */
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

describe('bulk selection helpers', () => {
  describe('computeSelectionAfterToggle — plain click', () => {
    it('selects an unchecked row and sets the anchor', () => {
      const problems = makeProblems(['P1', 'P2', 'P3']);
      const next = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'P2', { shiftKey: false });
      expect([...next.ids]).toEqual(['P2']);
      expect(next.anchorId).toBe('P2');
    });

    it('deselects a checked row and keeps it as anchor', () => {
      const problems = makeProblems(['P1', 'P2']);
      const selected = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'P1', { shiftKey: false });
      const next = computeSelectionAfterToggle(selected, problems, 'P1', { shiftKey: false });
      expect(next.ids.size).toBe(0);
      expect(next.anchorId).toBe('P1');
    });

    it('toggling a row twice returns to an empty selection', () => {
      const problems = makeProblems(['P1']);
      const once = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'P1', { shiftKey: false });
      expect(once.ids.size).toBe(1);
      const twice = computeSelectionAfterToggle(once, problems, 'P1', { shiftKey: false });
      expect(twice.ids.size).toBe(0);
      expect(twice.anchorId).toBe('P1');
    });
  });

  describe('computeSelectionAfterToggle — Shift+click ranges', () => {
    const problems = makeProblems(['A', 'B', 'C', 'D', 'E']);

    it('selects a downward range from the anchor', () => {
      const anchored = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'B', { shiftKey: false });
      const next = computeSelectionAfterToggle(anchored, problems, 'D', { shiftKey: true });
      // A single click on B selected B; shift-click extends B..D.
      expect([...next.ids].sort()).toEqual(['B', 'C', 'D']);
    });

    it('selects an upward range (anchor below the target)', () => {
      const anchored = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'D', { shiftKey: false });
      const next = computeSelectionAfterToggle(anchored, problems, 'B', { shiftKey: true });
      expect([...next.ids].sort()).toEqual(['B', 'C', 'D']);
    });

    it('shift-click never moves the anchor', () => {
      const anchored = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'B', { shiftKey: false });
      const shifted = computeSelectionAfterToggle(anchored, problems, 'E', { shiftKey: true });
      expect(shifted.anchorId).toBe('B');
    });

    it('deselects the anchor..target range when the shift-clicked row is already selected', () => {
      let state = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'A', { shiftKey: false });
      state = computeSelectionAfterToggle(state, problems, 'E', { shiftKey: true });
      expect([...state.ids].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
      // Anchor is A; Shift+click on C (checked) → deselect the A..C range.
      const next = computeSelectionAfterToggle(state, problems, 'C', { shiftKey: true });
      expect([...next.ids].sort()).toEqual(['D', 'E']);
    });

    it('falls back to a plain toggle when no anchor exists', () => {
      const next = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'C', { shiftKey: true });
      expect([...next.ids]).toEqual(['C']);
      expect(next.anchorId).toBe('C');
    });

    it('falls back to a plain toggle when the anchor is no longer displayed', () => {
      const withStaleAnchor = { ids: new Set<string>(['B']), anchorId: 'GONE' };
      const next = computeSelectionAfterToggle(withStaleAnchor, problems, 'D', { shiftKey: true });
      // GONE isn't in the display, so no range can be computed — D toggles on,
      // and B (still selected, though not displayed here) is untouched.
      expect(next.ids.has('D')).toBe(true);
      expect(next.ids.has('B')).toBe(true);
      expect(next.anchorId).toBe('D');
    });

    it('degrades to a plain toggle when anchor === clicked row', () => {
      const anchored = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, problems, 'C', { shiftKey: false });
      const next = computeSelectionAfterToggle(anchored, problems, 'C', { shiftKey: true });
      expect(next.ids.size).toBe(0); // toggled off
      expect(next.anchorId).toBe('C');
    });

    it('works at scale (40 rows, full-range selection)', () => {
      const many = makeProblems(Array.from({ length: 40 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`));
      let state = computeSelectionAfterToggle(EMPTY_PROBLEM_SELECTION, many, 'P01', { shiftKey: false });
      state = computeSelectionAfterToggle(state, many, 'P40', { shiftKey: true });
      expect(state.ids.size).toBe(40);
    });
  });

  describe('selectDisplayedIds — header checkbox', () => {
    it('selects exactly the displayed ids (not all loaded ids)', () => {
      const displayed = makeProblems(['P1', 'P2', 'P3']);
      // P4 simulates a problem that is loaded but filtered out / not shown.
      const next = selectDisplayedIds(EMPTY_PROBLEM_SELECTION, displayed.map(p => p.id), true);
      expect([...next.ids].sort()).toEqual(['P1', 'P2', 'P3']);
      expect(next.ids.has('P4')).toBe(false);
    });

    it('deselects only displayed ids, keeping unrelated ones intact', () => {
      const state = { ids: new Set(['P1', 'P2', 'X9']), anchorId: 'P1' };
      const next = selectDisplayedIds(state, ['P1', 'P2'], false);
      expect([...next.ids]).toEqual(['X9']);
    });

    it('is a no-op (same object) when every displayed id is already selected', () => {
      const state = { ids: new Set(['P1', 'P2']), anchorId: null };
      const next = selectDisplayedIds(state, ['P1', 'P2'], true);
      expect(next).toBe(state);
    });

    it('with zero displayed rows, select produces an empty selection', () => {
      const next = selectDisplayedIds(EMPTY_PROBLEM_SELECTION, [], true);
      expect(next.ids.size).toBe(0);
    });
  });

  describe('pruneSelectionToDisplayed — data refresh safety', () => {
    it('drops selected ids that are no longer displayed', () => {
      const problems = makeProblems(['P1', 'P2']);
      const state = { ids: new Set(['P1', 'P2', 'DELETED']), anchorId: 'DELETED' };
      const next = pruneSelectionToDisplayed(state, problems);
      expect([...next.ids].sort()).toEqual(['P1', 'P2']);
      expect(next.anchorId).toBeNull(); // the anchor vanished too
    });

    it('keeps everything when all selections are still displayed (Show More append)', () => {
      const before = makeProblems(['P1', 'P2']);
      const state = selectDisplayedIds(EMPTY_PROBLEM_SELECTION, before.map(p => p.id), true);
      // Simulate Show More: more rows appear, nothing disappears.
      const after = makeProblems(['P1', 'P2', 'P3', 'P4']);
      const next = pruneSelectionToDisplayed(state, after);
      expect(next).toBe(state); // no state replacement — selections intact
      expect(next.ids.has('P3')).toBe(false); // new rows start unselected
    });

    it('returns the same object for an empty selection', () => {
      const problems = makeProblems(['P1']);
      expect(pruneSelectionToDisplayed(EMPTY_PROBLEM_SELECTION, problems))
        .toBe(EMPTY_PROBLEM_SELECTION);
    });
  });

  describe('applyRowSelection — drag gesture state', () => {
    it('applies the gesture-decided state to a row', () => {
      const next = applyRowSelection(EMPTY_PROBLEM_SELECTION, 'P1', true, 'P1');
      expect([...next.ids]).toEqual(['P1']);
      expect(next.anchorId).toBe('P1');
    });

    it('dragging over an already-selected row (deselect gesture) removes it', () => {
      const state = { ids: new Set(['P1', 'P2']), anchorId: 'P1' };
      const next = applyRowSelection(state, 'P2', false, 'P1');
      expect([...next.ids]).toEqual(['P1']);
      expect(next.anchorId).toBe('P1');
    });

    it('is idempotent per row (re-applying the same state is a no-op)', () => {
      const state = applyRowSelection(EMPTY_PROBLEM_SELECTION, 'P1', true, 'P1');
      const again = applyRowSelection(state, 'P1', true, 'P1');
      expect(again).toBe(state);
    });
  });
});
