import * as db from '../db';
import unzipper from 'unzipper';
import { replaceProblemTestcasesFromZipFile } from '../services/problemQueryService';

jest.mock('../db');
jest.mock('unzipper');

describe('replaceProblemTestcasesFromZipFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('opens the assembled ZIP by path and replaces testcases transactionally', async () => {
    const files = [
      { path: 'input1.in', type: 'File', buffer: async () => Buffer.from('1 2\n') },
      { path: 'output1.out', type: 'File', buffer: async () => Buffer.from('3\n') },
    ];
    (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ files });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'P1' }] });
    const clientQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const release = jest.fn();
    (db.pool.connect as jest.Mock).mockResolvedValueOnce({ query: clientQuery, release });

    await expect(replaceProblemTestcasesFromZipFile('P1', '/tmp/assembled-testcases.zip'))
      .resolves.toEqual({ kind: 'ok', insertedCount: 1 });

    expect(unzipper.Open.file).toHaveBeenCalledWith('/tmp/assembled-testcases.zip');
    expect(unzipper.Open.buffer).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQuery).toHaveBeenNthCalledWith(2, 'DELETE FROM testcases WHERE problem_id = $1', ['P1']);
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
      ['P1', 1, '1 2\n', '3\n'],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
