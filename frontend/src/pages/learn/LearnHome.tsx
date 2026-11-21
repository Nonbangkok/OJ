import { Link, useNavigate } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import { Button, EmptyState, InlineError, PageHeader, ProgressBar, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import learnService from '../../services/learnService';
import { useLearnData } from '../../features/learn/useLearnData';
import { lessonPath, trackPath } from '../../features/learn/paths';
import type { LearnTracksResponse } from '../../types';
import styles from '../../features/learn/Learn.module.css';

const loadTracks = (): Promise<LearnTracksResponse> => learnService.getTracks();

/** /learn — every track in order, plus the next lesson to continue. */
export default function LearnHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, failed, reload } = useLearnData('tracks', loadTracks);
  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  const tracks = data?.tracks ?? [];
  const totalLessons = tracks.reduce((sum, t) => sum + t.lessonCount, 0);
  const completed = tracks.reduce((sum, t) => sum + (t.completedCount ?? 0), 0);
  const next = data?.continueLesson ?? null;
  const firstTrack = tracks.find((t) => t.lessonCount > 0);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Learn"
        description="Lessons in order, each ending with problems you can solve right here."
        meta={user && data && totalLessons > 0 ? `${completed} / ${totalLessons} lessons completed` : undefined}
      />

      {failed && <InlineError message="Couldn't load the lessons." onRetry={reload} />}
      {loading && !data && <p className={styles.muted} aria-live="polite">Loading lessons…</p>}

      {data && tracks.length === 0 && (
        <EmptyState
          title="No lessons yet"
          description={isStaff
            ? <>Import a lessons bundle in <Link to="/admin/lessons">Manage › Lessons</Link>.</>
            : 'Lessons will appear here once they are published.'}
        />
      )}

      {data && next && (
        <section className={styles.continue} aria-labelledby="learn-continue">
          <div className={styles.continueText}>
            <h2 id="learn-continue" className={styles.sectionLabel}>Continue</h2>
            <p className={styles.continueTitle}>{next.lessonTitle}</p>
            <p className={styles.continueMeta}>{`${next.trackTitle} › ${next.moduleTitle} · ${next.minutes} min`}</p>
          </div>
          <Button onClick={() => navigate(lessonPath(next.trackSlug, next.lessonSlug))}>Continue</Button>
        </section>
      )}

      {data && !next && user && firstTrack && completed === 0 && (
        <section className={styles.continue} aria-labelledby="learn-start">
          <div className={styles.continueText}>
            <h2 id="learn-start" className={styles.sectionLabel}>Start here</h2>
            <p className={styles.continueTitle}>{firstTrack.title}</p>
            {firstTrack.description && <p className={styles.continueMeta}>{firstTrack.description}</p>}
          </div>
          <Button onClick={() => navigate(trackPath(firstTrack.slug))}>Start</Button>
        </section>
      )}

      {tracks.length > 0 && (
        <section aria-labelledby="learn-tracks" className={styles.module}>
          <h2 id="learn-tracks" className={styles.sectionLabel}>Tracks</h2>
          <ol className={styles.list}>
            {tracks.map((track, index) => (
              <li key={track.slug}>
                <Link to={trackPath(track.slug)} className={styles.trackRow}>
                  <span className={styles.index} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.trackText}>
                    <span className={styles.trackTitle}>
                      {track.title}
                      {!track.isVisible && <StatusBadge tone="warning" soft>Hidden</StatusBadge>}
                    </span>
                    {track.description && <span className={styles.trackDescription}>{track.description}</span>}
                    <span className={styles.trackMeta}>
                      {`${track.moduleCount} ${track.moduleCount === 1 ? 'module' : 'modules'} · ${track.lessonCount} ${track.lessonCount === 1 ? 'lesson' : 'lessons'}`}
                    </span>
                  </span>
                  {track.completedCount !== null && (
                    <span className={styles.trackProgress}>
                      <span>{`${track.completedCount} / ${track.lessonCount} completed`}</span>
                      <ProgressBar value={track.completedCount} max={track.lessonCount} label={`${track.title} progress`} />
                    </span>
                  )}
                  <CaretRight size={16} aria-hidden="true" className={styles.caret} />
                </Link>
              </li>
            ))}
          </ol>
          {!user && <p className={styles.muted}><Link to="/login?returnTo=%2Flearn">Log in</Link> to keep track of the lessons you finish.</p>}
        </section>
      )}
    </div>
  );
}
