import { LessonBundleError, readLessonBundle } from '../../services/lessonBundleReader';
import { buildLessonBundle, lessonBundleEntries, PNG_1PX, sampleTracks, zipOf } from '../fixtures/lessonBundle';
import { withDeclaredSize } from '../fixtures/zipPatch';

const messages = (issues: Array<{ path: string; message: string }>) => issues.map((i) => `${i.path}: ${i.message}`);

describe('readLessonBundle', () => {
  it('reads, orders and renders a valid bundle', async () => {
    const bundle = await readLessonBundle(await buildLessonBundle(sampleTracks()));
    expect(bundle.issues).toEqual([]);
    expect(bundle.sourceCommit).toBe('a1b2c3d');
    expect(bundle.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.tracks.map((t) => [t.slug, t.position])).toEqual([['foundations', 1], ['graphs', 2]]);
    const [timeComplexity, prefix] = bundle.tracks[0].modules[0].lessons;
    expect(timeComplexity.position).toBe(1);
    expect(prefix).toMatchObject({ slug: 'prefix-sums', position: 2, minutes: 12, problemRefs: ['P0002', 'P0002'] });
    expect(prefix.html).toContain('data-lesson="problem" data-problem="P0002"');
    expect(prefix.assets).toEqual([{ name: 'figure-1.png', mimeType: 'image/png', data: PNG_1PX }]);
    expect(prefix.toc).toEqual([{ id: 'section-1', text: 'ไอเดีย', level: 2 }]);
  });

  it('gives the same lesson the same hash and changes it with content', async () => {
    const first = await readLessonBundle(await buildLessonBundle(sampleTracks()));
    const again = await readLessonBundle(await buildLessonBundle(sampleTracks()));
    const edited = sampleTracks();
    edited[0].modules[0].lessons[0].body += '\n\nเพิ่มอีกนิด';
    const changed = await readLessonBundle(await buildLessonBundle(edited));
    const hashOf = (b: typeof first) => b.tracks[0].modules[0].lessons.map((l) => l.contentHash);
    expect(hashOf(again)).toEqual(hashOf(first));
    expect(hashOf(changed)[0]).not.toBe(hashOf(first)[0]);
    expect(hashOf(changed)[1]).toBe(hashOf(first)[1]);
  });

  it('collects content issues with their paths instead of stopping at the first', async () => {
    const tracks = sampleTracks();
    tracks[0].modules[0].lessons[0].body = ':::hint\nไม่ได้ปิด';
    tracks[1].modules[0].lessons.push({ slug: 'time-complexity', title: 'Dup', body: 'ซ้ำ' });
    const entries = lessonBundleEntries(tracks);
    entries['foundations/01-complexity/assets/figure-1.png'] = Buffer.from('not an image');
    const bundle = await readLessonBundle(await zipOf(entries));
    expect(messages(bundle.issues)).toEqual(expect.arrayContaining([
      'foundations/01-complexity/time-complexity.md: Line 1: :::hint is not closed',
      'foundations/01-complexity/assets/figure-1.png: content is not a image/png image',
      'graphs/01-traversal/time-complexity.md: lesson slug "time-complexity" is already used by foundations/01-complexity/time-complexity.md',
    ]));
  });

  it('requires problems named in the body to be listed in module.json', async () => {
    const tracks = sampleTracks();
    tracks[1].modules[0].lessons[0].body += '\n\n:::problem P0042';
    const bundle = await readLessonBundle(await buildLessonBundle(tracks));
    expect(messages(bundle.issues)).toEqual([
      'graphs/01-traversal/bfs.md: problem "P0042" is used in the lesson but missing from its "problems" list in module.json',
    ]);
  });

  it('checks JSON shape, folder names and missing files', async () => {
    const entries = lessonBundleEntries(sampleTracks());
    entries['graphs/track.json'] = JSON.stringify({ slug: 'graph', title: 'Graphs', modules: ['01-traversal'] });
    entries['foundations/01-complexity/module.json'] = '{ nope';
    const bundle = await readLessonBundle(await zipOf(entries));
    expect(messages(bundle.issues)).toEqual([
      'foundations/01-complexity/module.json: is not valid JSON',
      'graphs/track.json: slug "graph" must equal its folder name "graphs"',
    ]);

    const missing = lessonBundleEntries(sampleTracks());
    delete missing['graphs/01-traversal/bfs.md'];
    const result = await readLessonBundle(await zipOf(missing));
    expect(messages(result.issues)).toEqual(['graphs/01-traversal/bfs.md: file is missing from the bundle']);
  });

  it('rejects unknown keys and bad slugs', async () => {
    const entries = lessonBundleEntries(sampleTracks());
    entries['graphs/01-traversal/module.json'] = JSON.stringify({
      slug: 'Traversal', title: 'x', lessons: [{ slug: 'bfs', title: 'BFS', minutes: 5, file: 'bfs.md', problems: [], extra: 1 }],
    });
    const bundle = await readLessonBundle(await zipOf(entries));
    expect(bundle.issues).toHaveLength(1);
    expect(bundle.issues[0].message).toMatch(/slug: must be lowercase kebab-case/);
    expect(bundle.issues[0].message).toMatch(/extra/);
  });

  it('flags files nothing references once the rest is clean', async () => {
    const entries = lessonBundleEntries(sampleTracks());
    entries['graphs/01-traversal/notes.txt'] = 'ลืมลบ';
    entries['__MACOSX/._x'] = 'junk';
    const bundle = await readLessonBundle(await zipOf(entries));
    expect(messages(bundle.issues)).toEqual(['graphs/01-traversal/notes.txt: file is not referenced by manifest.json, track.json or module.json']);
  });

  it('refuses unusable archives outright', async () => {
    await expect(readLessonBundle(Buffer.from('not a zip'))).rejects.toThrow(LessonBundleError);
    await expect(readLessonBundle(await zipOf({ 'readme.md': 'x' }))).rejects.toThrow('no manifest.json');
  });

  it('does not trust declared sizes', async () => {
    const entries = lessonBundleEntries(sampleTracks());
    entries['graphs/01-traversal/bfs.md'] = 'ก'.repeat(150_000);
    const zip = withDeclaredSize(await zipOf(entries), 'graphs/01-traversal/bfs.md', 10);
    const bundle = await readLessonBundle(zip);
    expect(messages(bundle.issues)).toEqual(['graphs/01-traversal/bfs.md: file does not match the size the ZIP declares']);

    const honest = lessonBundleEntries(sampleTracks());
    honest['graphs/01-traversal/bfs.md'] = 'ก'.repeat(150_000);
    expect(messages((await readLessonBundle(await zipOf(honest))).issues))
      .toEqual(['graphs/01-traversal/bfs.md: file is larger than 204800 bytes']);
  });
});
