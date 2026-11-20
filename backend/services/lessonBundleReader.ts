import { createHash } from 'node:crypto';
import path from 'node:path';
import * as unzipper from 'unzipper';
import { z } from 'zod';
import {
  LESSON_ASSET_NAME_PATTERN,
  LESSON_ASSET_TYPES,
  LESSON_BUNDLE_FORMAT,
  LESSON_LIMITS,
  LESSON_PROBLEM_ID_PATTERN,
  LESSON_PROBLEM_ROLES,
  LESSON_SLUG_MAX_LENGTH,
  LESSON_SLUG_PATTERN,
  type LessonProblemRole,
} from '../constants/lessons';
import { assertSafeArchive, type ArchiveEntryLike } from '../utils/archiveSafety';
import { createInflateBudget, readZipEntryBounded, ZipEntryLimitError, type ArchiveInflateBudget } from '../utils/zipEntryReader';
import { LessonContentError, renderLessonMarkdown, type LessonTocEntry } from './lessonMarkdown';

/**
 * Reads a lessons bundle (spec §4) built by CP-Author's `run.sh build-lessons`:
 *
 *   manifest.json                     { format: 1, sourceCommit?, tracks: [<trackDir>…] }
 *   <trackDir>/track.json             { slug (= trackDir), title, description?, modules: [<moduleDir>…] }
 *   <trackDir>/<moduleDir>/module.json { slug, title, summary?, lessons: [{ slug, title, summary?,
 *                                        minutes, file, problems: [{ id, role }], assets?: [name…] }] }
 *   <trackDir>/<moduleDir>/<file>.md
 *   <trackDir>/<moduleDir>/assets/<name>
 *
 * Order in the JSON arrays is the display order. Every lesson is rendered here,
 * so a bundle that reads without issues is ready to import. Content problems
 * are collected as issues (path + message) so a dry run can list all of them;
 * a ZIP that cannot be read at all throws LessonBundleError.
 */

export class LessonBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LessonBundleError';
  }
}

export interface LessonBundleIssue {
  path: string;
  message: string;
}

export interface BundleAsset {
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface BundleLesson {
  slug: string;
  title: string;
  summary: string | null;
  minutes: number;
  position: number;
  file: string;
  source: string;
  html: string;
  toc: LessonTocEntry[];
  problems: Array<{ id: string; role: LessonProblemRole }>;
  /** Problem ids named inside the body (:::problem / :::solution). */
  problemRefs: string[];
  assets: BundleAsset[];
  contentHash: string;
}

export interface BundleModule {
  slug: string;
  title: string;
  summary: string | null;
  position: number;
  lessons: BundleLesson[];
}

export interface BundleTrack {
  slug: string;
  title: string;
  description: string | null;
  position: number;
  modules: BundleModule[];
}

export interface LessonBundle {
  sha256: string;
  sourceCommit: string | null;
  tracks: BundleTrack[];
  issues: LessonBundleIssue[];
}

const slug = z.string().max(LESSON_SLUG_MAX_LENGTH).regex(LESSON_SLUG_PATTERN, 'must be lowercase kebab-case');
const title = z.string().trim().min(1).max(LESSON_LIMITS.MAX_TITLE_LENGTH);
const summary = z.string().trim().max(LESSON_LIMITS.MAX_SUMMARY_LENGTH).optional();
const dirName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'must be a plain folder name');
const unique = <T>(values: T[]) => new Set(values).size === values.length;

const manifestSchema = z.object({
  format: z.literal(LESSON_BUNDLE_FORMAT),
  sourceCommit: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
  tracks: z.array(dirName).min(1).max(LESSON_LIMITS.MAX_TRACKS).refine(unique, 'track folders must be unique'),
}).strict();

const trackSchema = z.object({
  slug,
  title,
  description: z.string().trim().max(LESSON_LIMITS.MAX_SUMMARY_LENGTH).optional(),
  modules: z.array(dirName).min(1).max(LESSON_LIMITS.MAX_MODULES_PER_TRACK).refine(unique, 'module folders must be unique'),
}).strict();

const lessonSchema = z.object({
  slug,
  title,
  summary,
  minutes: z.number().int().min(1).max(LESSON_LIMITS.MAX_READING_MINUTES),
  file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.md$/, 'must be a .md file next to module.json'),
  problems: z.array(z.object({
    id: z.string().regex(LESSON_PROBLEM_ID_PATTERN),
    role: z.enum(LESSON_PROBLEM_ROLES),
  }).strict()).max(LESSON_LIMITS.MAX_PROBLEMS_PER_LESSON)
    .refine((list) => unique(list.map((p) => p.id)), 'a problem may appear once per lesson'),
  assets: z.array(z.string().regex(LESSON_ASSET_NAME_PATTERN)).max(LESSON_LIMITS.MAX_ASSETS_PER_LESSON)
    .refine(unique, 'asset names must be unique').optional(),
}).strict();

const moduleSchema = z.object({
  slug,
  title,
  summary,
  lessons: z.array(lessonSchema).min(1).max(LESSON_LIMITS.MAX_LESSONS_PER_MODULE),
}).strict();

const formatZodIssues = (error: z.ZodError): string => error.issues
  .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
  .slice(0, 5)
  .join('; ');

const isIgnoredEntry = (entryPath: string): boolean =>
  entryPath === '__MACOSX' || entryPath.startsWith('__MACOSX/') || path.posix.basename(entryPath) === '.DS_Store';

function sniffImage(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

type ZipFile = unzipper.File;

class BundleFiles {
  private readonly budget: ArchiveInflateBudget = createInflateBudget(LESSON_LIMITS.BUNDLE_MAX_INFLATED_BYTES);
  private readonly used = new Set<string>();

  constructor(private readonly entries: Map<string, ZipFile>) {}

  has(entryPath: string): boolean {
    return this.entries.has(entryPath);
  }

  async read(entryPath: string, maxBytes: number): Promise<Buffer> {
    const entry = this.entries.get(entryPath);
    if (!entry) throw new LessonContentError('file is missing from the bundle');
    this.used.add(entryPath);
    try {
      return await readZipEntryBounded(entry, maxBytes, this.budget);
    } catch (error) {
      if (error instanceof ZipEntryLimitError) {
        if (error.message.includes('decompression bomb')) throw new LessonBundleError(error.message);
        if (error.message.includes('declared size')) throw new LessonContentError('file does not match the size the ZIP declares');
        throw new LessonContentError(`file is larger than ${maxBytes} bytes`);
      }
      throw error;
    }
  }

  async readJson(entryPath: string): Promise<unknown> {
    const text = (await this.read(entryPath, LESSON_LIMITS.MAX_JSON_BYTES)).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new LessonContentError('is not valid JSON');
    }
  }

  unused(): string[] {
    return [...this.entries.keys()].filter((entryPath) => !this.used.has(entryPath)).sort();
  }
}

async function openBundle(zip: Buffer): Promise<BundleFiles> {
  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(zip);
  } catch {
    throw new LessonBundleError('The upload is not a readable ZIP file.');
  }
  try {
    assertSafeArchive(directory.files as unknown as ArchiveEntryLike[]);
  } catch (error) {
    throw new LessonBundleError((error as Error).message);
  }
  const files = directory.files.filter((entry) => entry.type === 'File' && !isIgnoredEntry(entry.path));
  if (files.length > LESSON_LIMITS.MAX_ENTRIES) {
    throw new LessonBundleError(`The bundle has more than ${LESSON_LIMITS.MAX_ENTRIES} files.`);
  }
  const entries = new Map<string, ZipFile>();
  for (const entry of files) {
    if (entry.path.includes('\\') || entry.path !== path.posix.normalize(entry.path) || entry.path.startsWith('/')) {
      throw new LessonBundleError(`ZIP entry "${entry.path}" has an unsupported path.`);
    }
    if (entries.has(entry.path)) throw new LessonBundleError(`ZIP entry "${entry.path}" appears twice.`);
    entries.set(entry.path, entry);
  }
  return new BundleFiles(entries);
}

function hashLesson(lesson: Omit<BundleLesson, 'contentHash' | 'html' | 'toc' | 'problemRefs'>, trackSlug: string, moduleSlug: string): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    trackSlug, moduleSlug, slug: lesson.slug, title: lesson.title, summary: lesson.summary,
    minutes: lesson.minutes, position: lesson.position, problems: lesson.problems,
  }));
  hash.update('\0');
  hash.update(lesson.source);
  for (const asset of lesson.assets) {
    hash.update('\0');
    hash.update(asset.name);
    hash.update(createHash('sha256').update(asset.data).digest());
  }
  return hash.digest('hex');
}

/** Read, validate and render a bundle. Throws LessonBundleError only when the ZIP itself is unusable. */
export async function readLessonBundle(zip: Buffer): Promise<LessonBundle> {
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const files = await openBundle(zip);
  const issues: LessonBundleIssue[] = [];
  const issue = (entryPath: string, message: string) => { issues.push({ path: entryPath, message }); };

  const guard = async <T>(entryPath: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof LessonContentError) { issue(entryPath, error.message); return null; }
      throw error;
    }
  };

  if (!files.has('manifest.json')) throw new LessonBundleError('The bundle has no manifest.json at its root.');
  const manifestRaw = await guard('manifest.json', () => files.readJson('manifest.json'));
  const manifest = manifestRaw === null ? null : manifestSchema.safeParse(manifestRaw);
  if (!manifest || !manifest.success) {
    if (manifest && !manifest.success) issue('manifest.json', formatZodIssues(manifest.error));
    return { sha256, sourceCommit: null, tracks: [], issues };
  }

  const tracks: BundleTrack[] = [];
  const lessonSlugs = new Map<string, string>();
  let lessonCount = 0;

  for (const [trackIndex, trackDir] of manifest.data.tracks.entries()) {
    const trackPath = `${trackDir}/track.json`;
    const trackRaw = await guard(trackPath, () => files.readJson(trackPath));
    if (trackRaw === null) continue;
    const track = trackSchema.safeParse(trackRaw);
    if (!track.success) { issue(trackPath, formatZodIssues(track.error)); continue; }
    if (track.data.slug !== trackDir) { issue(trackPath, `slug "${track.data.slug}" must equal its folder name "${trackDir}"`); continue; }

    const modules: BundleModule[] = [];
    const moduleSlugs = new Set<string>();
    for (const [moduleIndex, moduleDir] of track.data.modules.entries()) {
      const base = `${trackDir}/${moduleDir}`;
      const modulePath = `${base}/module.json`;
      const moduleRaw = await guard(modulePath, () => files.readJson(modulePath));
      if (moduleRaw === null) continue;
      const parsed = moduleSchema.safeParse(moduleRaw);
      if (!parsed.success) { issue(modulePath, formatZodIssues(parsed.error)); continue; }
      if (moduleSlugs.has(parsed.data.slug)) { issue(modulePath, `module slug "${parsed.data.slug}" is used twice in this track`); continue; }
      moduleSlugs.add(parsed.data.slug);

      const lessons: BundleLesson[] = [];
      for (const [lessonIndex, meta] of parsed.data.lessons.entries()) {
        const lessonPath = `${base}/${meta.file}`;
        lessonCount += 1;
        const firstUse = lessonSlugs.get(meta.slug);
        if (firstUse) { issue(lessonPath, `lesson slug "${meta.slug}" is already used by ${firstUse}`); continue; }
        lessonSlugs.set(meta.slug, lessonPath);

        const assets: BundleAsset[] = [];
        let assetsOk = true;
        for (const name of meta.assets ?? []) {
          const assetPath = `${base}/assets/${name}`;
          const extension = path.posix.extname(name).slice(1).toLowerCase();
          const expected = LESSON_ASSET_TYPES[extension];
          if (!expected) { issue(assetPath, 'only .png, .jpg, .jpeg, .webp and .gif images are allowed'); assetsOk = false; continue; }
          const data = await guard(assetPath, () => files.read(assetPath, LESSON_LIMITS.MAX_ASSET_BYTES));
          if (data === null) { assetsOk = false; continue; }
          const sniffed = sniffImage(data);
          if (sniffed !== expected) { issue(assetPath, `content is not a ${expected} image`); assetsOk = false; continue; }
          assets.push({ name, mimeType: expected, data });
        }

        const sourceBuffer = await guard(lessonPath, () => files.read(lessonPath, LESSON_LIMITS.MAX_MARKDOWN_BYTES));
        if (sourceBuffer === null || !assetsOk) continue;
        const source = sourceBuffer.toString('utf8');
        if (Buffer.from(source, 'utf8').compare(sourceBuffer) !== 0) { issue(lessonPath, 'is not valid UTF-8'); continue; }

        let rendered;
        try {
          rendered = renderLessonMarkdown(source, assets.map((a) => a.name));
        } catch (error) {
          if (error instanceof LessonContentError) { issue(lessonPath, error.message); continue; }
          throw error;
        }

        const listed = new Set(meta.problems.map((p) => p.id));
        const unlisted = [...new Set(rendered.problemRefs.filter((id) => !listed.has(id)))];
        if (unlisted.length > 0) {
          issue(lessonPath, `problem ${unlisted.map((id) => `"${id}"`).join(', ')} is used in the lesson but missing from its "problems" list in module.json`);
          continue;
        }

        const lesson = {
          slug: meta.slug,
          title: meta.title,
          summary: meta.summary || null,
          minutes: meta.minutes,
          position: lessonIndex + 1,
          file: lessonPath,
          source,
          problems: meta.problems,
          assets,
        };
        lessons.push({
          ...lesson,
          html: rendered.html,
          toc: rendered.toc,
          problemRefs: rendered.problemRefs,
          contentHash: hashLesson(lesson, track.data.slug, parsed.data.slug),
        });
      }
      modules.push({
        slug: parsed.data.slug,
        title: parsed.data.title,
        summary: parsed.data.summary || null,
        position: moduleIndex + 1,
        lessons,
      });
    }
    tracks.push({
      slug: track.data.slug,
      title: track.data.title,
      description: track.data.description || null,
      position: trackIndex + 1,
      modules,
    });
  }

  if (lessonCount > LESSON_LIMITS.MAX_LESSONS) {
    issue('manifest.json', `the bundle has ${lessonCount} lessons; the limit is ${LESSON_LIMITS.MAX_LESSONS}`);
  }
  // Only meaningful once everything else read cleanly: a broken module.json
  // would otherwise list its lessons here too.
  if (issues.length === 0) {
    for (const unused of files.unused()) {
      issue(unused, 'file is not referenced by manifest.json, track.json or module.json');
    }
  }

  return { sha256, sourceCommit: manifest.data.sourceCommit ?? null, tracks, issues };
}
