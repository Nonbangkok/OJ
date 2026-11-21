/**
 * Learn (lessons) API shapes — mirror backend/services/lessonQueryService.ts and
 * lessonImportService.ts. Spec: docs/superpowers/specs/2026-11-20-lessons-mvp-design.md
 */

export type LessonProblemRole = 'example' | 'practice' | 'challenge';
export type LearnProblemStatus = 'solved' | 'attempted' | 'not_tried';

export interface LearnTrackSummary {
  slug: string;
  title: string;
  description: string | null;
  isVisible: boolean;
  moduleCount: number;
  lessonCount: number;
  /** null for guests. */
  completedCount: number | null;
}

export interface LearnContinueLesson {
  trackSlug: string;
  trackTitle: string;
  moduleTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  minutes: number;
}

export interface LearnTracksResponse {
  tracks: LearnTrackSummary[];
  continueLesson: LearnContinueLesson | null;
}

export interface LearnLessonRow {
  slug: string;
  title: string;
  summary: string | null;
  minutes: number;
  completed: boolean | null;
  problemCount: number;
  solvedCount: number | null;
}

export interface LearnModule {
  slug: string;
  title: string;
  summary: string | null;
  lessons: LearnLessonRow[];
}

export interface LearnTrackResponse {
  track: { slug: string; title: string; description: string | null; isVisible: boolean };
  modules: LearnModule[];
}

export interface LessonTocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface LearnLessonProblem {
  position: number;
  role: LessonProblemRole;
  available: boolean;
  /** Staff only. */
  unavailableReason?: 'hidden' | 'in_contest';
  id: string | null;
  title: string | null;
  difficulty: number | null;
  problemType: string | null;
  status: LearnProblemStatus | null;
  bestScore: number | null;
  caseStatuses: string[] | null;
}

export interface LearnLessonLink {
  slug: string;
  title: string;
}

export interface LearnLessonResponse {
  lesson: {
    slug: string;
    title: string;
    summary: string | null;
    minutes: number;
    /** Sanitized at import; `{{ASSET_BASE}}` stands for the lesson's asset route. */
    html: string;
    toc: LessonTocEntry[];
    updatedAt: string;
    completed: boolean | null;
  };
  track: { slug: string; title: string };
  module: { slug: string; title: string; lessonCount: number; completedCount: number | null };
  previous: LearnLessonLink | null;
  next: LearnLessonLink | null;
  problems: LearnLessonProblem[];
}

export interface LessonProgressResponse {
  completed: boolean;
  completedAt: string | null;
}

// ---------- Manage › Lessons ----------

export interface LessonDiffItem {
  slug: string;
  title: string;
  track: string;
  module: string;
}

export interface LessonRemovalItem extends LessonDiffItem {
  usersWithProgress: number;
}

export interface LessonBundleIssue {
  path: string;
  message: string;
}

export interface LessonImportPlan {
  bundleSha256: string;
  sourceCommit: string | null;
  lessons: {
    added: LessonDiffItem[];
    changed: LessonDiffItem[];
    removed: LessonRemovalItem[];
    unchanged: number;
  };
  tracks: { added: string[]; removed: string[] };
  issues: LessonBundleIssue[];
}

/** What POST /admin/lessons/import answered, normalised across its status codes. */
export type LessonImportOutcome =
  | { kind: 'preview'; plan: LessonImportPlan }
  | { kind: 'imported'; plan: LessonImportPlan; importId: number }
  | { kind: 'invalid'; plan: LessonImportPlan; message: string }
  | { kind: 'needs_confirmation'; plan: LessonImportPlan; message: string };

export interface AdminLessonTrack {
  id: number;
  slug: string;
  title: string;
  is_visible: boolean;
  module_count: number;
  lesson_count: number;
  updated_at: string;
}

export interface AdminLessonImport {
  id: number;
  imported_by: string | null;
  bundle_sha256: string;
  source_commit: string | null;
  added: number;
  changed: number;
  removed: number;
  created_at: string;
}

export interface AdminLessonOverview {
  tracks: AdminLessonTrack[];
  imports: AdminLessonImport[];
}
