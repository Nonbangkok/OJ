import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsClockwise, Fire } from '@phosphor-icons/react';

import { Button } from '../../components/ui';
import StatusBadge from '../../components/shared/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import contestService from '../../services/contestService';
import problemService from '../../services/problemService';
import userService from '../../services/userService';
import useHomeQuotes from '../../hooks/useHomeQuotes';
import { formatTimeAgo } from '../../utils/formatters';
import { difficultyBand } from '../../utils/constants';
import type { Contest, ProblemSummary, UserProgression } from '../../types';
import styles from './Home.module.css';
import quietActionStyles from '../../components/styles/QuietAction.module.css';

/** Compact summary derived from the profile endpoint. */
interface HomeProfileSummary {
  progression: UserProgression;
  problemsSolved: number;
  currentStreak: number;
}

const pickUnfinishedProblem = (
  problems: ProblemSummary[],
): ProblemSummary | null => {
  // Most recently attempted but not fully solved: latest_submission_at set and
  // best_score < 100. Ties resolved by taking the last one encountered.
  let candidate: ProblemSummary | null = null;
  for (const problem of problems) {
    if (!problem.latest_submission_at) continue;
    if ((problem.best_score ?? 0) >= 100) continue;
    if (
      candidate === null ||
      new Date(problem.latest_submission_at) >= new Date(candidate.latest_submission_at as string)
    ) {
      candidate = problem;
    }
  }
  return candidate;
};

const pickRandomProblem = (problems: ProblemSummary[]): ProblemSummary | null => {
  // Prefer a problem the user has not solved yet; fall back to any problem.
  const unsolved = problems.filter(
    (problem) => (problem.best_score ?? 0) < 100,
  );
  const pool = unsolved.length > 0 ? unsolved : problems;
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
};

const pickSuggestedProblem = (
  problems: ProblemSummary[],
): ProblemSummary | null => {
  // All caught up: suggest one unsolved, never-attempted problem — a real next
  // action rather than an empty state. Falls back to any unsolved, then null.
  const neverTried = problems.filter(
    (problem) => !problem.latest_submission_at && (problem.best_score ?? 0) < 100,
  );
  if (neverTried.length > 0) {
    return neverTried[Math.floor(Math.random() * neverTried.length)];
  }
  const unsolved = problems.filter((problem) => (problem.best_score ?? 0) < 100);
  if (unsolved.length > 0) {
    return unsolved[Math.floor(Math.random() * unsolved.length)];
  }
  return null;
};

const pickContest = (contests: Contest[]): Contest | null => {
  // Prefer a running contest (soonest end), else the nearest scheduled by start.
  const running = contests
    .filter((contest) => contest.status === 'running')
    .sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime());
  if (running.length > 0) return running[0];

  const scheduled = contests
    .filter((contest) => contest.status === 'scheduled')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  if (scheduled.length > 0) return scheduled[0];

  return null;
};

/** Client-side humanized countdown, e.g. "Ends in 1h 42m" / "Starts in 3d 4h". */
const contestCountdown = (contest: Contest, now: Date): string => {
  const target = new Date(contest.status === 'running' ? contest.end_time : contest.start_time);
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return contest.status === 'running' ? 'Ending soon' : 'Starting soon';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0) parts.push(`${minutes}m`);

  const label = contest.status === 'running' ? 'Ends in' : 'Starts in';
  return `${label} ${parts.join(' ')}`;
};

const Home = () => {
  const { user } = useAuth();
  const { isPrivateMode, registrationEnabled } = useSettings();
  const navigate = useNavigate();
  const { currentQuote, isFading, showAnotherQuote } = useHomeQuotes();

  const [profileSummary, setProfileSummary] = useState<HomeProfileSummary | null>(null);
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [contest, setContest] = useState<Contest | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    userService.getProfile(user.username)
      .then((profile) => {
        if (!cancelled) {
          setProfileSummary({
            progression: profile.progression,
            problemsSolved: profile.problemsSolved,
            currentStreak: profile.currentStreak,
          });
        }
      })
      .catch(() => {
        // Profile data is supplementary; the page stays usable without it.
      });

    problemService.getAllWithStats()
      .then((data) => {
        if (!cancelled) setProblems(data);
      })
      .catch(() => {
        if (!cancelled) setProblems([]);
      });

    contestService.getAll()
      .then((data) => {
        if (!cancelled) setContest(pickContest(data));
      })
      .catch(() => {
        if (!cancelled) setContest(null);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Keep the contest countdown fresh without a refetch.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const unfinishedProblem = useMemo(
    () => (problems ? pickUnfinishedProblem(problems) : null),
    [problems],
  );

  // All caught up: a concrete suggestion instead of an empty message.
  const suggestedProblem = useMemo(
    () => (problems && !unfinishedProblem ? pickSuggestedProblem(problems) : null),
    [problems, unfinishedProblem],
  );

  const handleRandomProblem = () => {
    const target = problems ? pickRandomProblem(problems) : null;
    if (target) {
      navigate(`/problems/${target.id}`);
    } else {
      navigate('/problems');
    }
  };

  if (!user) {
    if (isPrivateMode) {
      // Private-mode guest landing: no Browse Problems CTA — just the door.
      return (
        <div className={styles['home-container']}>
          <section className={styles['logged-out']}>
            <h1 className={styles['hero-title']}>Welcome to Grader</h1>
            <p className={styles['hero-subtitle']}>
              This Grader is private. Log in to access problems, contests, and submissions.
            </p>
            <div className={styles['hero-actions']}>
              <Button variant="primary" onClick={() => navigate('/login')}>
                Log in
              </Button>
              {registrationEnabled && (
                <Button variant="secondary" onClick={() => navigate('/register')}>
                  Create account
                </Button>
              )}
            </div>
          </section>
        </div>
      );
    }

    // Public-mode guest Home: a simple welcome with the two actions that make sense.
    return (
      <div className={styles['home-container']}>
        <section className={styles['logged-out']}>
          <h1 className={styles['hero-title']}>Welcome to Grader</h1>
          <p className={styles['hero-subtitle']}>Sharpen your skills with competitive programming problems.</p>
          <div className={styles['hero-actions']}>
            <Button variant="primary" onClick={() => navigate('/problems')}>
              Browse Problems
            </Button>
            <Button variant="secondary" onClick={() => navigate('/login')}>
              Log in
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const progression = profileSummary?.progression;

  const problemCard = unfinishedProblem ?? suggestedProblem;
  const problemIsSuggestion = !unfinishedProblem && suggestedProblem !== null;

  return (
    <div className={styles['home-container']}>
      {/* Hero — open, no card. Whitespace and type carry the hierarchy. */}
      <section className={styles.hero}>
        <div className={styles['hero-text']}>
          <h1 className={styles['hero-title']}>Welcome back, {user.username}</h1>
          {progression && (
            <p className={styles['hero-tier']}>
              {progression.tier} · Level {progression.level}
            </p>
          )}
          <p className={styles['hero-subtitle']}>Ready for another challenge?</p>
        </div>
        <div className={styles['hero-actions']}>
          {unfinishedProblem ? (
            <Button variant="primary" onClick={() => navigate(`/problems/${unfinishedProblem.id}`)}>
              Continue Solving
            </Button>
          ) : (
            <Button variant="primary" onClick={() => navigate('/problems')}>
              Browse Problems
            </Button>
          )}
          <button
            type="button"
            className={styles['ghost-action']}
            onClick={handleRandomProblem}
          >
            Random Problem
            <span className={quietActionStyles.arrow} aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      {/* Progress strip — one muted line, not three cards. */}
      {profileSummary && (
        <p className={styles['summary-strip']}>
          <span>{profileSummary.problemsSolved} solved</span>
          <span className={styles['summary-separator']} aria-hidden="true">·</span>
          <span className={styles['summary-streak']}>
            <Fire size={14} weight="fill" aria-hidden="true" />
            {profileSummary.currentStreak} day streak
          </span>
          {progression && (
            <>
              <span className={styles['summary-separator']} aria-hidden="true">·</span>
              <span>Level {progression.level} · {progression.totalXp.toLocaleString()} XP</span>
            </>
          )}
        </p>
      )}

      <hr className={styles.rule} aria-hidden="true" />

      {/* Main content: the problem to work on. A card is warranted here —
          it represents an actual object, not a container for text. */}
      {problemCard && (
        <section className={styles['problem-section']}>
          <h2 className={styles['section-title']}>
            {problemIsSuggestion ? 'Try something new' : 'Continue where you left off'}
          </h2>
          <div className={styles['problem-card']}>
            <div className={styles['problem-main']}>
              <p className={styles['problem-title']}>{problemCard.title}</p>
              <p className={styles['problem-meta']}>
                <span className={styles['problem-id']}>{problemCard.id}</span>
                {problemCard.difficulty != null && difficultyBand(problemCard.difficulty) != null && (
                  <span
                    className={styles[`difficulty-chip-${difficultyBand(problemCard.difficulty)}`]}
                    aria-label={`Difficulty ${problemCard.difficulty}`}
                  >
                    {problemCard.difficulty}
                  </span>
                )}
                {unfinishedProblem && (
                  <>
                    <span>
                      {Number(unfinishedProblem.submission_count ?? 0) === 1
                        ? '1 attempt'
                        : `${Number(unfinishedProblem.submission_count ?? 0)} attempts`}
                    </span>
                    <span>Last tried {formatTimeAgo(unfinishedProblem.latest_submission_at)}</span>
                  </>
                )}
              </p>
            </div>
            <Button
              variant={problemIsSuggestion ? 'secondary' : 'primary'}
              onClick={() => navigate(`/problems/${problemCard.id}`)}
            >
              {problemIsSuggestion ? 'Solve Problem' : 'Continue'} →
            </Button>
          </div>
        </section>
      )}

      {/* Caught up with nothing to suggest (everything solved): a light
          positive line, not a big empty card. */}
      {!problemCard && problems !== null && problems.length > 0 && (
        <p className={styles['caught-up']}>
          {"You’re all caught up — every problem is solved. Enjoy the calm."}
        </p>
      )}

      {contest && (
        <section className={styles['contest-section']}>
          <h2 className={styles['section-title']}>
            {contest.status === 'running' ? 'Active Contest' : 'Upcoming Contest'}
          </h2>
          <p className={styles['problem-title']}>{contest.title}</p>
          <div className={styles['contest-row']}>
            <StatusBadge status={contest.status} />
            <span>{contestCountdown(contest, now)}</span>
            <button
              type="button"
              className={styles['ghost-action']}
              onClick={() => navigate(`/contests/${contest.id}`)}
            >
              Open Contest
              <span className={quietActionStyles.arrow} aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {/* Quote — pure typography, no box. */}
      <section className={styles['quote-section']} aria-label="Coding quote">
        <p
          data-testid="home-quote"
          className={`${styles['quote-text']} ${isFading ? styles.fading : ''}`}
        >
          “{currentQuote}”
        </p>
        <button
          type="button"
          className={styles['quote-shuffle']}
          onClick={showAnotherQuote}
        >
          <ArrowsClockwise size={16} aria-hidden="true" />
          Another quote
        </button>
      </section>
    </div>
  );
};

export default Home;
