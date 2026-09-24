import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsClockwise } from '@phosphor-icons/react';

import { Button } from '../../components/ui';
import StatusBadge from '../../components/shared/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import contestService from '../../services/contestService';
import problemService from '../../services/problemService';
import userService from '../../services/userService';
import useHomeQuotes from '../../hooks/useHomeQuotes';
import { formatTimeAgo } from '../../utils/formatters';
import type { Contest, ProblemSummary, UserProgression } from '../../types';
import styles from './Home.module.css';

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

const formatStreak = (days: number): string => (days === 1 ? '1 day' : `${days} days`);

const Home = () => {
  const { user } = useAuth();
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

  const handleContinueSolving = () => {
    if (unfinishedProblem) {
      navigate(`/problems/${unfinishedProblem.id}`);
    } else {
      navigate('/problems');
    }
  };

  const handleRandomProblem = () => {
    const target = problems ? pickRandomProblem(problems) : null;
    if (target) {
      navigate(`/problems/${target.id}`);
    } else {
      navigate('/problems');
    }
  };

  if (!user) {
    // Logged-out Home: a simple welcome with the two actions that make sense.
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

  return (
    <div className={styles['home-container']}>
      <section className={styles.hero}>
        <div className={styles['hero-text']}>
          <h1 className={styles['hero-title']}>Welcome back, {user.username}</h1>
          <p className={styles['hero-subtitle']}>Ready for another problem?</p>
          {progression && (
            <p className={styles['hero-tier']}>
              {progression.tier} · Level {progression.level}
            </p>
          )}
        </div>
        <div className={styles['hero-actions']}>
          <Button variant="primary" onClick={handleContinueSolving}>
            {unfinishedProblem ? 'Continue Solving' : 'Start Solving'}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/problems')}>
            Browse Problems
          </Button>
          <Button variant="secondary" onClick={handleRandomProblem}>
            Random Problem
          </Button>
        </div>
      </section>

      {profileSummary && (
        <section className={styles['stat-grid']}>
          <div className={styles['stat-card']}>
            <span className={styles['stat-label']}>Problems Solved</span>
            <span className={styles['stat-value']}>{profileSummary.problemsSolved}</span>
          </div>
          <div className={styles['stat-card']}>
            <span className={styles['stat-label']}>Current Streak</span>
            <span className={styles['stat-value']}>{formatStreak(profileSummary.currentStreak)}</span>
          </div>
          <div className={styles['stat-card']}>
            <span className={styles['stat-label']}>Experience</span>
            <span className={styles['stat-value']}>
              {progression ? `${progression.totalXp.toLocaleString()} XP · Level ${progression.level}` : '—'}
            </span>
            {progression && (
              <div
                className={styles['level-progress']}
                role="progressbar"
                aria-label={`XP to next level: ${progression.levelProgress.remaining} XP remaining`}
                aria-valuemin={0}
                aria-valuemax={progression.levelProgress.required}
                aria-valuenow={progression.levelProgress.current}
              >
                <div
                  className={styles['level-progress-fill']}
                  style={{ width: `${progression.levelProgress.percentage}%` }}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {(unfinishedProblem !== null || (problems !== null && problems.length > 0) || contest !== null) && (
        <section className={styles['duo-row']}>
          {unfinishedProblem ? (
            <div className={styles['duo-card']}>
              <h2 className={styles['card-title']}>Continue where you left off</h2>
              <p className={styles['problem-title']}>{unfinishedProblem.title}</p>
              <p className={styles['problem-meta']}>
                <span className={styles['problem-id']}>{unfinishedProblem.id}</span>
                {unfinishedProblem.difficulty != null && (
                  <span>Difficulty {unfinishedProblem.difficulty}</span>
                )}
                <span>
                  {Number(unfinishedProblem.submission_count ?? 0) === 1
                    ? '1 attempt'
                    : `${Number(unfinishedProblem.submission_count ?? 0)} attempts`}
                </span>
                <span>Last tried {formatTimeAgo(unfinishedProblem.latest_submission_at)}</span>
              </p>
              <Button variant="primary" onClick={() => navigate(`/problems/${unfinishedProblem.id}`)}>
                Continue →
              </Button>
            </div>
          ) : problems !== null && problems.length > 0 ? (
            <div className={styles['duo-card']}>
              <h2 className={styles['card-title']}>Pick your next challenge</h2>
              <p className={styles['problem-meta']}>
                You have no unfinished problems — every attempted problem is solved.
              </p>
              <Button variant="primary" onClick={() => navigate('/problems')}>
                Find a Problem
              </Button>
            </div>
          ) : null}
          {contest && (
            <div className={styles['duo-card']}>
              <div className={styles['contest-header']}>
                <h2 className={styles['card-title']}>Contest</h2>
                <StatusBadge status={contest.status} />
              </div>
              <p className={styles['problem-title']}>{contest.title}</p>
              <p className={styles['problem-meta']}>
                <span>{contestCountdown(contest, now)}</span>
              </p>
              <Button variant="secondary" onClick={() => navigate(`/contests/${contest.id}`)}>
                Open Contest →
              </Button>
            </div>
          )}
        </section>
      )}

      <section className={styles['quote-card']}>
        <p
          data-testid="home-quote"
          className={`${styles['quote-text']} ${isFading ? styles.fading : ''}`}
        >
          {currentQuote}
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
