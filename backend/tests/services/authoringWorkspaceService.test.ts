import { getWorkspacePreviewContext } from '../../services/authoringWorkspaceService';

const id = '11111111-1111-4111-8111-111111111111';
const avatar = Buffer.from('stored avatar');
const database = (rows: unknown[][]) => ({ query: jest.fn().mockImplementation(async () => ({ rows: rows.shift() ?? [] })) });

test('loads the safe shell and asset names without reading or embedding asset contents', async () => {
  const db = database([
    [{ id, problem_id: 'task<&', title: 'Title', author_aka_name: 'AKA', author_real_name: 'Author',
      language: 'Thai', country_code: 'THA', author_profile_image_png: avatar, template_version: 'red-gate-v1' }],
    [{ id: '22222222-2222-4222-8222-222222222222', filename: 'diagram.png' }],
  ]);

  const context = await getWorkspacePreviewContext(id, db as never);

  expect(context?.assets).toEqual([{ id: '22222222-2222-4222-8222-222222222222', filename: 'diagram.png' }]);
  expect(context?.html).toContain('<article id="statement" class="statement"></article>');
  expect(context?.html).toContain('img-src \'self\' data:');
  expect(context?.html).toContain("script-src 'none'");
  expect(context?.html).not.toContain('<script');
  expect(context?.html).not.toContain('diagram.png');
  expect(db.query).toHaveBeenCalledTimes(2);
  expect(db.query.mock.calls[1]?.[0]).toContain('SELECT id,filename');
});

test('returns null for a missing draft and rejects unsupported template versions', async () => {
  await expect(getWorkspacePreviewContext(id, database([[]]) as never)).resolves.toBeNull();
  await expect(getWorkspacePreviewContext(id, database([
    [{ id, problem_id: 'task', title: 'Title', author_aka_name: 'AKA', author_real_name: 'Author',
      language: 'Thai', country_code: 'THA', author_profile_image_png: avatar, template_version: 'future' }],
  ]) as never)).rejects.toMatchObject({ code: 'unsupported_template' });
});
