import { getDraftTestcaseStats } from '../../services/authoringTestcaseQueryService';
import * as db from '../../db';

jest.mock('../../db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('getDraftTestcaseStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns total and paired-output counts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '5', with_output: '3' }] } as never);

    const stats = await getDraftTestcaseStats('draft-1');

    expect(stats).toEqual({ total: 5, withOutput: 3 });
    expect(String(mockQuery.mock.calls[0][0])).toContain('count(output_data)');
    expect(mockQuery.mock.calls[0][1]).toEqual(['draft-1']);
  });

  it('returns zeros when the draft has no testcases', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', with_output: '0' }] } as never);

    const stats = await getDraftTestcaseStats('empty-draft');

    expect(stats).toEqual({ total: 0, withOutput: 0 });
  });

  it('is resilient to a missing row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const stats = await getDraftTestcaseStats('ghost');

    expect(stats).toEqual({ total: 0, withOutput: 0 });
  });
});
