import { ZipArchive } from 'archiver';

/** Builders for lessons bundles (spec §4) used by the lesson tests. */

export interface FixtureLesson {
  slug: string;
  title: string;
  body: string;
  minutes?: number;
  file?: string;
  summary?: string;
  problems?: Array<{ id: string; role: 'example' | 'practice' | 'challenge' }>;
  assets?: Record<string, Buffer>;
}

export interface FixtureModule {
  dir: string;
  slug: string;
  title: string;
  lessons: FixtureLesson[];
}

export interface FixtureTrack {
  slug: string;
  title: string;
  description?: string;
  modules: FixtureModule[];
}

export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function zipOf(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

/** The bundle's files as a name → content map (edit it to build broken bundles). */
export function lessonBundleEntries(tracks: FixtureTrack[], sourceCommit = 'a1b2c3d'): Record<string, string | Buffer> {
  const entries: Record<string, string | Buffer> = {
    'manifest.json': JSON.stringify({ format: 1, sourceCommit, tracks: tracks.map((t) => t.slug) }),
  };
  for (const track of tracks) {
    entries[`${track.slug}/track.json`] = JSON.stringify({
      slug: track.slug, title: track.title, description: track.description, modules: track.modules.map((m) => m.dir),
    });
    for (const module of track.modules) {
      const base = `${track.slug}/${module.dir}`;
      entries[`${base}/module.json`] = JSON.stringify({
        slug: module.slug,
        title: module.title,
        lessons: module.lessons.map((lesson) => ({
          slug: lesson.slug,
          title: lesson.title,
          summary: lesson.summary,
          minutes: lesson.minutes ?? 10,
          file: lesson.file ?? `${lesson.slug}.md`,
          problems: lesson.problems ?? [],
          ...(lesson.assets ? { assets: Object.keys(lesson.assets) } : {}),
        })),
      });
      for (const lesson of module.lessons) {
        entries[`${base}/${lesson.file ?? `${lesson.slug}.md`}`] = lesson.body;
        for (const [name, data] of Object.entries(lesson.assets ?? {})) entries[`${base}/assets/${name}`] = data;
      }
    }
  }
  return entries;
}

export const buildLessonBundle = (tracks: FixtureTrack[], sourceCommit?: string): Promise<Buffer> =>
  zipOf(lessonBundleEntries(tracks, sourceCommit));

/** A small, realistic Foundations track (casual Thai content, English chrome). */
export function sampleTracks(): FixtureTrack[] {
  return [{
    slug: 'foundations',
    title: 'Foundations',
    description: 'พื้นฐานที่ใช้บ่อยที่สุด เริ่มตรงนี้ได้เลย',
    modules: [{
      dir: '01-complexity',
      slug: 'complexity',
      title: 'Complexity',
      lessons: [
        {
          slug: 'time-complexity',
          title: 'Time Complexity',
          minutes: 8,
          body: '## ทำไมต้องสนใจเวลา\n\nโค้ดถูกแต่ช้าก็ได้ TLE นะ ลองนับคร่าว ๆ ก่อนเขียนกันดีกว่า',
          problems: [{ id: 'P0001', role: 'example' }],
        },
        {
          slug: 'prefix-sums',
          title: 'Prefix Sums',
          minutes: 12,
          body: [
            '## ไอเดีย',
            '',
            'เตรียม $P_i$ ไว้ก่อน แล้วถามผลรวมช่วงได้ทันทีเลย',
            '',
            ':::problem P0002',
            '',
            ':::solution P0002',
            '```cpp',
            'cout << P[r] - P[l - 1];',
            '```',
            ':::',
            '',
            '![ภาพอธิบาย](assets/figure-1.png)',
          ].join('\n'),
          problems: [{ id: 'P0002', role: 'example' }, { id: 'P0003', role: 'practice' }],
          assets: { 'figure-1.png': PNG_1PX },
        },
      ],
    }],
  }, {
    slug: 'graphs',
    title: 'Graphs',
    modules: [{
      dir: '01-traversal',
      slug: 'traversal',
      title: 'Traversal',
      lessons: [{ slug: 'bfs', title: 'BFS', body: '## BFS\n\nเดินทีละชั้น ใช้ queue ช่วยจำ', problems: [] }],
    }],
  }];
}
