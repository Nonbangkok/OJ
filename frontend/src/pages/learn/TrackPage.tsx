import { Link, useParams } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import { EmptyState, InlineError, PageHeader, ProgressBar, StatusBadge, StatusMark } from '../../components/ui';
import learnService from '../../services/learnService';
import { useLearnData } from '../../features/learn/useLearnData';
import { LEARN_PATH, lessonPath } from '../../features/learn/paths';
import type { LearnLessonRow, LearnTrackResponse } from '../../types';
import styles from '../../features/learn/Learn.module.css';

const loadTrack = (slug: string): Promise<LearnTrackResponse> => learnService.getTrack(slug);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const problemFact = (lesson: LearnLessonRow): string => {
  if (lesson.problemCount === 0) return 'No problems';
  if (lesson.solvedCount === null) return plural(lesson.problemCount, 'problem');
  return `Solved ${lesson.solvedCount} / ${lesson.problemCount}`;
};

/** /learn/:trackSlug — the track's modules and lessons with progress. */
export default function TrackPage() {
  const { trackSlug = '' } = useParams();
  const { data, loading, notFound, failed, reload } = useLearnData(trackSlug, loadTrack);

  if (notFound) {
    return (
      <div className={styles.page}>
        <EmptyState title="Track not found" description={<Link to={LEARN_PATH}>Back to all lessons</Link>} />
      </div>
    );
  }
  if (failed) return <div className={styles.page}><InlineError message="Couldn't load this track." onRetry={reload} /></div>;
  if (loading || !data) return <div className={styles.page}><p className={styles.muted} aria-live="polite">Loading track…</p></div>;

  const lessons = data.modules.flatMap((m) => m.lessons);
  const signedIn = lessons.some((l) => l.completed !== null);
  const completed = lessons.filter((l) => l.completed).length;

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Learn', to: LEARN_PATH }, { label: data.track.title }]}
        title={<>{data.track.title}{!data.track.isVisible && <> <StatusBadge tone="warning" soft>Hidden</StatusBadge></>}</>}
        description={data.track.description ?? undefined}
        meta={`${plural(data.modules.length, 'module')} · ${plural(lessons.length, 'lesson')}`}
        actions={signedIn && lessons.length > 0 ? (
          <div className={styles.progressBlock}>
            <span>{`${completed} / ${lessons.length} completed`}</span>
            <ProgressBar value={completed} max={lessons.length} label={`${data.track.title} progress`} tone={completed === lessons.length ? 'pass' : 'neutral'} />
          </div>
        ) : undefined}
      />

      {data.modules.map((module, index) => {
        const done = module.lessons.filter((l) => l.completed).length;
        const headingId = `module-${module.slug}`;
        return (
          <section key={module.slug} className={styles.module} aria-labelledby={headingId}>
            <div className={styles.moduleHead}>
              <span className={styles.index} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h2 id={headingId} className={styles.moduleTitle}>{module.title}</h2>
              {signedIn && <span className={styles.moduleCount}>{`${done} / ${module.lessons.length} completed`}</span>}
            </div>
            {module.summary && <p className={styles.moduleSummary}>{module.summary}</p>}
            {module.lessons.length === 0 ? (
              <p className={styles.muted}>No lessons in this module yet.</p>
            ) : (
              <ol className={styles.list}>
                {module.lessons.map((lesson) => (
                  <li key={lesson.slug}>
                    <Link to={lessonPath(data.track.slug, lesson.slug)} className={styles.lessonRow}>
                      <StatusMark tone={lesson.completed ? 'pass' : 'none'} />
                      <span className={styles.lessonTitle}>
                        {lesson.title}
                        {lesson.completed && <span className={styles.srOnly}> (completed)</span>}
                        {lesson.summary && <span className={styles.lessonSummary}>{lesson.summary}</span>}
                      </span>
                      <span className={styles.lessonFact}>{`${lesson.minutes} min`}</span>
                      <span className={styles.lessonFact}>{problemFact(lesson)}</span>
                      <CaretRight size={14} aria-hidden="true" className={styles.caret} />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
