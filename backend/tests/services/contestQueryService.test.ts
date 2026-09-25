import {
  deleteContest,
  getContestDetail,
  moveSingleProblemToMainSystem,
} from '../../services/contestQueryService';
import * as db from '../../db';

jest.mock('../../db');
jest.mock('../../services/contestAccess', () => ({
  getContestById: jest.fn(),
  isContestParticipant: jest.fn(),
}));
jest.mock('../../services/contestScoreboardQueryService', () => ({
  getContestScoreboard: jest.fn(),
}));
jest.mock('../../services/contestParticipantQueryService', () => ({
  getContestProblemsForParticipant: jest.fn(),
  getContestProblemDetailForParticipant: jest.fn(),
  getContestProblemPdfForParticipant: jest.fn(),
}));

const query = db.query as jest.Mock;
const poolConnect = db.pool.connect as jest.Mock;

const { getContestById, isContestParticipant } = jest.requireMock('../../services/contestAccess') as {
  getContestById: jest.Mock;
  isContestParticipant: jest.Mock;
};

describe('contest exit paths restore the visibility snapshot (XSYS-004/CONTEST-006)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    poolConnect.mockReset();
    poolConnect.mockImplementation(async () => ({
      query: (...args: unknown[]) => query(...(args as [])),
      release: jest.fn(),
    }));
  });

  it('single move-back restores pre-contest visibility instead of leaving the problem hidden', async () => {
    getContestById.mockResolvedValue({ id: 1, status: 'running' });
    query.mockResolvedValueOnce({ rows: [{ id: 'P1', title: 'Problem 1' }] });

    const result = await moveSingleProblemToMainSystem('1', 'P1');

    expect(result).toEqual({ kind: 'ok', data: { id: 'P1', title: 'Problem 1' } });
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('contest_id = NULL');
    expect(String(sql)).toContain('is_visible = COALESCE(is_visible_before_contest, TRUE)');
    expect(String(sql)).toContain('is_visible_before_contest = NULL');
    expect(params).toEqual(['P1', '1']);
  });

  it('contest delete restores pre-contest visibility atomically', async () => {
    getContestById.mockResolvedValue({ id: 3, status: 'finished' });
    query.mockResolvedValue({ rows: [] });

    const result = await deleteContest('3');

    expect(result).toBe('deleted');
    const restoreCall = query.mock.calls.find(([text]) => String(text).includes('UPDATE problems'));
    expect(restoreCall).toBeDefined();
    expect(String(restoreCall![0])).toContain('is_visible = COALESCE(is_visible_before_contest, TRUE)');
    expect(String(restoreCall![0])).toContain('WHERE contest_id = $1');
    expect(restoreCall![1]).toEqual(['3']);
    // Detach + delete ran in one transaction.
    expect(query).toHaveBeenCalledWith('BEGIN');
    expect(query).toHaveBeenCalledWith('DELETE FROM contests WHERE id = $1', ['3']);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('contest delete rolls back when the restore fails', async () => {
    getContestById.mockResolvedValue({ id: 3, status: 'finished' });
    query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('restore failed'));

    await expect(deleteContest('3')).rejects.toThrow('restore failed');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });
});

describe('getContestDetail participant gate (Phase 3 semantics)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const contestRow = {
    id: 1, title: 'Contest', description: null, start_time: new Date(),
    end_time: new Date(), status: 'running', created_at: new Date(),
    created_by: 1, participant_count: 5, created_by_username: 'admin',
  };

  it('hides the problems list of a running contest from a non-participant regular user', async () => {
    query.mockResolvedValueOnce({ rows: [contestRow] }); // contest row
    isContestParticipant.mockResolvedValueOnce(false);

    const detail = await getContestDetail('1', { id: 42, role: 'user' });

    expect(detail?.problems).toEqual([]);
    // No problems query ran.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('shows running-contest problems to a participant', async () => {
    query
      .mockResolvedValueOnce({ rows: [contestRow] }) // contest row
      .mockResolvedValueOnce({ rows: [{ id: 'P1', title: 'Secret Problem', author: null }] });
    isContestParticipant.mockResolvedValueOnce(true);

    const detail = await getContestDetail('1', { id: 42, role: 'user' });

    expect(detail?.problems).toEqual([{ id: 'P1', title: 'Secret Problem', author: null }]);
  });

  it('shows running-contest problems to staff regardless of participation', async () => {
    query
      .mockResolvedValueOnce({ rows: [contestRow] })
      .mockResolvedValueOnce({ rows: [{ id: 'P1', title: 'Secret Problem', author: null }] });
    isContestParticipant.mockResolvedValueOnce(false);

    const detail = await getContestDetail('1', { id: 1, role: 'staff' });

    expect(detail?.problems).toHaveLength(1);
  });

  it('keeps finished-contest problems public (frozen snapshot)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...contestRow, status: 'finished' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'P1', title: 'Snapshot', author: null }] });

    const detail = await getContestDetail('1', undefined);

    expect(detail?.problems).toHaveLength(1);
    expect(String(query.mock.calls[1][0])).toContain('FROM contest_problems');
  });
});
