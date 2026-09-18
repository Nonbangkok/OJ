import { readQueuedFile } from '../../services/authoringJobQueryService';
import { TestcaseError } from '../../authoring/testcases';
import { JobDatabase } from '../../services/authoringJobQueryService';

jest.mock('../../db', () => ({}));

const databaseWithRows = (rows: unknown[]): JobDatabase =>
  ({ query: jest.fn().mockResolvedValue({ rows }) } as unknown as JobDatabase);

describe('readQueuedFile', () => {
  it('reports missing expected-output captures with the expected-output error code', async () => {
    const database = databaseWithRows([]);

    await expect(
      readQueuedFile('job-id', 'output:case-id', database),
    ).rejects.toMatchObject({
      constructor: TestcaseError,
      code: 'invalid_expected_outputs',
      message: 'Captured expected output is missing',
    });
  });

  it('reports missing PDF captures with the PDF error code', async () => {
    const database = databaseWithRows([]);

    await expect(
      readQueuedFile('job-id', 'avatar', database),
    ).rejects.toMatchObject({
      constructor: TestcaseError,
      code: 'invalid_pdf_inputs',
      message: 'Captured PDF file is missing',
    });
  });

  it('returns stored content for an existing capture', async () => {
    const content = Buffer.from('captured');
    const database = databaseWithRows([{ content }]);

    await expect(readQueuedFile('job-id', 'avatar', database)).resolves.toBe(content);
  });
});
