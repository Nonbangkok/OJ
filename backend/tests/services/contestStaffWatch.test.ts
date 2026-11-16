import * as db from '../../db';
import {
  getContestProblemDetailForParticipant,
  getContestProblemPdfForParticipant,
  getContestProblemStarterForParticipant,
} from '../../services/contestParticipantQueryService';

jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../services/contestAccess', () => ({
  getContestById: jest.fn(),
  isContestParticipant: jest.fn(),
  isContestManagementRole: jest.fn((viewer?: { role: string }) => viewer?.role === 'staff' || viewer?.role === 'admin'),
}));

const query = db.query as jest.Mock;
const { getContestById, isContestParticipant } = jest.requireMock('../../services/contestAccess') as {
  getContestById: jest.Mock;
  isContestParticipant: jest.Mock;
};

/** Staff watch a running contest without joining it (§7.7): the problem pages they are linked to must open. */
describe('staff watching a contest open its problems without joining', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getContestById.mockResolvedValue({ id: 1, status: 'running', is_visible: true });
    isContestParticipant.mockResolvedValue(false);
    query.mockResolvedValue({ rows: [{ id: 'P1', problem_pdf: Buffer.from('%PDF'), problem_type: 'header' }] });
  });

  it('the problem detail opens for staff and still refuses a student who has not joined', async () => {
    expect(await getContestProblemDetailForParticipant('1', 'P1', 9, { id: 9, role: 'staff' })).toMatchObject({ kind: 'ok' });
    expect(await getContestProblemDetailForParticipant('1', 'P1', 7, { id: 7, role: 'user' })).toEqual({ kind: 'not_participant' });
  });

  it('the PDF and the starter files open for staff', async () => {
    expect((await getContestProblemPdfForParticipant('1', 'P1', 9, { id: 9, role: 'admin' })).kind).not.toBe('not_participant');
    expect((await getContestProblemStarterForParticipant('1', 'P1', 9, { id: 9, role: 'staff' })).kind).not.toBe('not_participant');
  });
});
