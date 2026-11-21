import { useEffect, useState, type MouseEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CaretLeft, CaretRight, CheckCircle } from '@phosphor-icons/react';
import {
  Button, DifficultyBadge, EmptyState, InlineError, PageHeader, ProgressBar, StatusBadge, StatusMark, TestcaseStrip,
  useToast, type VerdictTone,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import learnService from '../../services/learnService';
import LessonContent from '../../features/learn/LessonContent';
import { problemPath } from '../../features/learn/lessonHtml';
import { useLearnData } from '../../features/learn/useLearnData';
import { LEARN_PATH, lessonPath, trackPath } from '../../features/learn/paths';
import type { LearnLessonProblem, LearnLessonResponse, LessonTocEntry } from '../../types';
import styles from '../../features/learn/Learn.module.css';

const loadLesson = (slug: string): Promise<LearnLessonResponse> => learnService.getLesson(slug);

const ROLE_LABELS: Record<LearnLessonProblem['role'], string> = { example: 'Example', practice: 'Practice', challenge: 'Challenge' };
const UPDATED = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const markTone = (problem: LearnLessonProblem): VerdictTone =>
  problem.status === 'solved' ? 'pass' : problem.status === 'attempted' ? 'fail' : 'none';

function LessonToc({ toc }: { toc: LessonTocEntry[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const headings = toc.map((entry) => document.getElementById(entry.id)).filter((h): h is HTMLElement => h !== null);
    if (headings.length === 0) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const topmost = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (topmost) setActive(topmost.target.id);
    }, { rootMargin: '0px 0px -70% 0px' });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [toc]);

  const current = toc.some((entry) => entry.id === active) ? active : toc[0]?.id;
  const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav aria-label="On this page">
      <h2 className={styles.sectionLabel}>On this page</h2>
      <ul className={styles.toc}>
        {toc.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(event) => jump(event, entry.id)}
              aria-current={entry.id === current ? 'location' : undefined}
              className={[styles.tocLink, entry.level === 3 ? styles.tocNested : '', entry.id === current ? styles.tocActive : ''].filter(Boolean).join(' ')}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PracticeTable({ problems, isStaff }: { problems: LearnLessonProblem[]; isStaff: boolean }) {
  const solved = problems.filter((p) => p.status === 'solved').length;
  const signedIn = problems.some((p) => p.status !== null);
  return (
    <section aria-labelledby="practice-problems" className={styles.module}>
      <div className={styles.practiceHead}>
        <h2 id="practice-problems" className={styles.practiceTitle}>Practice problems</h2>
        {signedIn && <span className={styles.practiceCount}>{`Solved ${solved} / ${problems.length}`}</span>}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.markCell}><span className={styles.srOnly}>Status</span></th>
              <th scope="col">ID</th>
              <th scope="col">Problem</th>
              <th scope="col" className={styles.hideOnPhone}>Type</th>
              <th scope="col" className={styles.hideOnPhone}>Difficulty</th>
              <th scope="col">Best</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((problem) => {
              const visibleToViewer = problem.available || (isStaff && problem.id);
              if (!visibleToViewer || !problem.id) {
                return (
                  <tr key={`unavailable-${problem.position}`} className={styles.unavailableRow}>
                    <td className={styles.markCell}><StatusMark tone="none" /></td>
                    <td className={styles.idCell}>—</td>
                    <td colSpan={4}>Problem unavailable <span className={styles.muted}>· hidden or part of a running contest</span></td>
                  </tr>
                );
              }
              const strip = (problem.caseStatuses ?? []).map((status) => ({ status }));
              return (
                <tr key={problem.id} className={problem.available ? undefined : styles.unavailableRow}>
                  <td className={styles.markCell}>
                    <StatusMark tone={markTone(problem)} />
                    {problem.status && <span className={styles.srOnly}>{problem.status === 'not_tried' ? 'Not tried' : problem.status === 'solved' ? 'Solved' : 'Attempted'}</span>}
                  </td>
                  <td className={styles.idCell}>{problem.id}</td>
                  <td>
                    <Link to={problemPath(problem.id)} className={styles.problemLink}>{problem.title}</Link>
                    {!problem.available && (
                      <> <StatusBadge tone="warning" soft>{problem.unavailableReason === 'in_contest' ? 'In a contest' : 'Hidden'}</StatusBadge></>
                    )}
                  </td>
                  <td className={styles.hideOnPhone}>
                    <StatusBadge tone={problem.role === 'challenge' ? 'warning' : 'neutral'} soft>{ROLE_LABELS[problem.role]}</StatusBadge>
                  </td>
                  <td className={styles.hideOnPhone}><DifficultyBadge difficulty={problem.difficulty} /></td>
                  <td className={styles.bestCell}>
                    {strip.length > 0 ? (
                      <span className={styles.best}><TestcaseStrip results={strip} />{problem.bestScore ?? 0}</span>
                    ) : <span className={styles.muted}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** /learn/:trackSlug/:lessonSlug — one lesson, its practice problems, and completion. */
export default function LessonPage() {
  const { trackSlug = '', lessonSlug = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, notFound, failed, reload, update } = useLearnData(lessonSlug, loadLesson);
  const [saving, setSaving] = useState(false);
  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  if (notFound) {
    return (
      <div className={styles.page}>
        <EmptyState title="Lesson not found" description={<Link to={LEARN_PATH}>Back to all lessons</Link>} />
      </div>
    );
  }
  if (failed) return <div className={styles.page}><InlineError message="Couldn't load this lesson." onRetry={reload} /></div>;
  if (loading || !data) return <div className={styles.page}><p className={styles.muted} aria-live="polite">Loading lesson…</p></div>;
  // A lesson that moved to another track keeps working from old links.
  if (data.track.slug !== trackSlug) return <Navigate to={lessonPath(data.track.slug, data.lesson.slug)} replace />;

  const { lesson, module, track } = data;
  const signedIn = lesson.completed !== null;

  const setCompleted = async (completed: boolean) => {
    const patch = (value: boolean) => (current: LearnLessonResponse): LearnLessonResponse => ({
      ...current,
      lesson: { ...current.lesson, completed: value },
      module: { ...current.module, completedCount: Math.max(0, (current.module.completedCount ?? 0) + (value ? 1 : -1)) },
    });
    setSaving(true);
    update(patch(completed));
    try {
      await learnService.setCompleted(lesson.slug, completed);
    } catch {
      update(patch(!completed));
      toast.show("Couldn't save your progress. Try again.", { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Learn', to: LEARN_PATH }, { label: track.title, to: trackPath(track.slug) }, { label: module.title }]}
        title={lesson.title}
        meta={[`${lesson.minutes} min read`, `${data.problems.length} ${data.problems.length === 1 ? 'problem' : 'problems'}`, `Updated ${UPDATED.format(new Date(lesson.updatedAt))}`].join(' · ')}
        actions={lesson.completed ? (
          <span className={styles.done}><CheckCircle size={16} weight="fill" aria-hidden="true" />Completed</span>
        ) : undefined}
      />

      <div className={styles.lessonLayout}>
        <article className={styles.lessonMain} aria-label={lesson.title}>
          <LessonContent lessonSlug={lesson.slug} html={lesson.html} problems={data.problems} />
          {data.problems.length > 0 && <PracticeTable problems={data.problems} isStaff={isStaff} />}

          <footer className={styles.footer}>
            {data.previous ? (
              <Link to={lessonPath(track.slug, data.previous.slug)} className={styles.navLink} aria-label={`Previous lesson: ${data.previous.title}`}>
                <CaretLeft size={14} aria-hidden="true" /><span>{data.previous.title}</span>
              </Link>
            ) : <span />}
            <span className={styles.footerSpacer} />
            {signedIn ? (
              <Button
                variant={lesson.completed ? 'secondary' : 'primary'}
                loading={saving}
                loadingLabel="Saving…"
                onClick={() => { void setCompleted(!lesson.completed); }}
              >
                {lesson.completed ? 'Mark as not completed' : 'Mark as completed'}
              </Button>
            ) : (
              <Link to={`/login?returnTo=${encodeURIComponent(lessonPath(track.slug, lesson.slug))}`} className={styles.navLink}>
                <span>Log in to save progress</span>
              </Link>
            )}
            <span className={styles.footerSpacer} />
            {data.next ? (
              <Link to={lessonPath(track.slug, data.next.slug)} className={styles.navLink} aria-label={`Next lesson: ${data.next.title}`}>
                <span>{data.next.title}</span><CaretRight size={14} aria-hidden="true" />
              </Link>
            ) : <span />}
          </footer>
        </article>

        <aside className={styles.rail}>
          {lesson.toc.length > 0 && <LessonToc toc={lesson.toc} />}
          <div className={styles.railModule}>
            <hr className={styles.divider} />
            <h2 className={styles.sectionLabel}>This module</h2>
            <p><Link to={trackPath(track.slug)} className={styles.railLesson}>{module.title}</Link></p>
            {module.completedCount !== null && (
              <>
                <ProgressBar value={module.completedCount} max={module.lessonCount} label={`${module.title} progress`} />
                <p className={styles.muted}>{`${module.completedCount} / ${module.lessonCount} completed`}</p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
