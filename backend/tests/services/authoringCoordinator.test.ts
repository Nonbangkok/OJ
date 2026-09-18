import { AuthoringSpool } from '../../authoring/spool';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import { JobDatabase } from '../../services/authoringJobQueryService';

jest.mock('../../db', () => ({}));

it('discards the connection if releasing its session advisory lock fails', async () => {
  const failure = new Error('connection lost while unlocking');
  const client = {
    query: jest.fn().mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce(failure),
    release: jest.fn(),
  };
  const database = {
    pool: { connect: jest.fn().mockResolvedValue(client) },
    query: jest.fn().mockResolvedValue({ rows: [] }),
  } as unknown as JobDatabase;
  const spool = new AuthoringSpool('/unused-test-spool');
  jest.spyOn(spool, 'jobIds').mockResolvedValue([]);
  jest.spyOn(spool, 'cleanupStaging').mockResolvedValue();

  await expect(reconcileAuthoringJobs(spool, database)).rejects.toBe(failure);
  // An uncertain session lock must not remain attached to a reusable pooled connection.
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(client.release).toHaveBeenCalledWith(true);
});
