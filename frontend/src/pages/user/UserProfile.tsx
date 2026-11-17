import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Circle, PencilSimple } from '@phosphor-icons/react';

import ActivityHeatmap from '../../components/user/ActivityHeatmap';
import ProblemSolvingProfile from '../../features/user/ProblemSolvingProfile';
import LoadingPage from '../../components/shared/LoadingPage';
import { DifficultyBadge, ProgressBar } from '../../components/ui';
import type { AchievementStats } from '../../types';
import { useAuth } from '../../context/AuthContext';
import userService from '../../services/userService';
import {
  ACHIEVEMENT_CATALOG,
  progressFraction,
  progressLabel,
} from '../../utils/achievements';
import { difficultyBand, getLanguageDisplayName } from '../../utils/constants';

import styles from './UserProfile.module.css';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });

const formatXp = (xp: number): string => xp.toLocaleString();

const formatRewardDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const verdictClass = (verdict: string): string =>
  verdict.split(' ')[0].toLowerCase();

const makeBarWidth = (counts: Record<string, number>) => {
  const max = Math.max(...Object.values(counts), 1);
  return (key: string): number => Math.round((counts[key] / max) * 100);
};



/**
 * Compact achievements: the next three locked ones by progress, then every
 * unlocked one; "Show all" lists the whole catalog.
 */
function Achievements({ stats, unlockedIds }: { stats: AchievementStats; unlockedIds: Set<string> }) {
  const [showAll, setShowAll] = useState(false);
  const locked = ACHIEVEMENT_CATALOG
    .filter((a) => !unlockedIds.has(a.id))
    .map((a) => ({ achievement: a, fraction: progressFraction(a, stats) }))
    .sort((x, y) => y.fraction - x.fraction);
  const unlocked = ACHIEVEMENT_CATALOG.filter((a) => unlockedIds.has(a.id));
  const shownLocked = showAll ? locked : locked.slice(0, 3);
  return (
    <section className={styles.section} aria-label="Achievements">
      <div className={styles['section-head']}>
        <h2>Achievements</h2>
        <span>{`${unlocked.length} of ${ACHIEVEMENT_CATALOG.length} unlocked`}</span>
        {locked.length > 3 && (
          <button type="button" className={styles['show-all']} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </div>
      <ul className={styles['achievement-list']}>
        {shownLocked.map(({ achievement, fraction }) => (
          <li key={achievement.id} data-state="locked" data-progress={fraction.toFixed(3)} className={styles['achievement-row']}>
            <Circle size={14} aria-hidden="true" className={styles['achievement-mark']} />
            <span className={styles['achievement-text']}>
              <b>{achievement.name}</b>
              <span>{achievement.description}</span>
            </span>
            <span className={styles['achievement-progress']}>
              <ProgressBar value={Math.round(fraction * 100)} max={100} label={`${achievement.name} progress`} />
              <span>{progressLabel(achievement, stats) ?? 'Not yet started'}</span>
            </span>
          </li>
        ))}
        {unlocked.map((achievement) => (
          <li key={achievement.id} data-state="unlocked" className={styles['achievement-row']}>
            <Check size={14} weight="bold" aria-hidden="true" className={styles['achievement-done']} />
            <span className={styles['achievement-text']}>
              <b>{achievement.name}</b>
              <span>{achievement.description}</span>
            </span>
            <span className={styles['achievement-unlocked']}>Unlocked</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const UserProfile = () => {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof userService.getProfile>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Navigating to another profile (same route, new :username) goes back to
  // the loading state before its fetch starts (adjust-state-while-rendering).
  const [loadedUsername, setLoadedUsername] = useState(username);
  if (username !== loadedUsername) {
    setLoadedUsername(username);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    userService.getProfile(username ?? '')
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  const handleAvatarSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !username) return;
    try {
      await userService.updateAvatar(file);
      const updated = await userService.getProfile(username);
      setProfile(updated);
    } catch {
      setError('Failed to update avatar');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [username]);

  if (loading) return <LoadingPage />;
  if (error) return <div className={`error-message ${styles['error-message']}`}>{error}</div>;
  if (!profile) return null;

  const isOwnProfile = user?.username === profile.username;
  const avatarVersion = profile.avatarUpdatedAt
    ? `?v=${new Date(profile.avatarUpdatedAt).getTime()}`
    : '';
  const verdictBarWidth = makeBarWidth(profile.verdictCounts);
  const languageBarWidth = makeBarWidth(profile.languageCounts);

  const unlockedIds = new Set(profile.achievements.unlocked.map((achievement) => achievement.id));

  const avatarContent = profile.hasAvatar ? (
    <img
      className={styles['profile-avatar']}
      src={`${process.env.REACT_APP_API_URL}/users/${profile.username}/avatar${avatarVersion}`}
      alt={`${profile.username}'s avatar`}
    />
  ) : (
    <span className={styles['profile-avatar']} aria-hidden="true">
      {profile.username[0]?.toLocaleUpperCase()}
    </span>
  );

  const recentSection = profile.recentRewards?.length > 0 ? (
    <section className={styles.section}>
      <h2>Recently Solved</h2>
      <ul className={styles['recent-solved-list']}>
        {profile.recentRewards.slice(0, 5).map((reward) => {
          const band = difficultyBand(reward.difficultySnapshot);
          return (
            <li key={`${reward.problemId}-${reward.awardedAt}`} className={styles['recent-solved-row']}>
              <Link className={styles['recent-solved-title']} to={`/problems/${reward.problemId}`}>
                <span className={styles['recent-solved-name']}>
                  {reward.problemTitle ?? reward.problemId}
                </span>
                <span className={styles['recent-solved-id']}>
                  {reward.problemId}
                </span>
              </Link>
              {/* An empty cell keeps the XP and date columns aligned when a problem is unrated. */}
              {reward.difficultySnapshot !== null && band !== null
                ? <span><DifficultyBadge difficulty={reward.difficultySnapshot} /></span>
                : <span aria-hidden="true" />}
              <span className={styles['recent-solved-gain']}>+{reward.xpAwarded} XP</span>
              <span className={styles['recent-solved-date']}>
                {formatRewardDate(reward.awardedAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;
  const verdictsSection = Object.keys(profile.verdictCounts).length > 0 ? (
    <section className={styles.section}>
      <h2>Verdicts</h2>
      <ul className={styles['breakdown-list']}>
        {Object.entries(profile.verdictCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([verdict, count]) => (
            <li key={verdict} className={styles['breakdown-row']}>
              <span className={styles['breakdown-name']}>
                <span className={`${styles['verdict-dot']} ${styles[`verdict-dot-${verdictClass(verdict)}`]}`} aria-hidden="true" />
                {verdict}
              </span>
              <span className={styles['breakdown-bar']} aria-hidden="true">
                <span
                  className={styles['breakdown-bar-fill']}
                  style={{ width: `${verdictBarWidth(verdict)}%` }}
                />
              </span>
              <span className={styles['breakdown-count']}>{count}</span>
            </li>
          ))}
      </ul>
    </section>
  ) : null;
  const languagesSection = Object.keys(profile.languageCounts).length > 0 ? (
    <section className={styles.section}>
      <h2>Languages</h2>
      <ul className={styles['breakdown-list']}>
        {Object.entries(profile.languageCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([language, count]) => (
            <li key={language} className={styles['breakdown-row']}>
              <span className={styles['breakdown-name']}>
                {getLanguageDisplayName(language)}
              </span>
              <span className={styles['breakdown-bar']} aria-hidden="true">
                <span
                  className={styles['breakdown-bar-fill']}
                  style={{ width: `${languageBarWidth(language)}%` }}
                />
              </span>
              <span className={styles['breakdown-count']}>{count}</span>
            </li>
          ))}
      </ul>
    </section>
  ) : null;
  // Recently solved on the left, breakdowns on the right; with nothing solved
  // yet the two breakdowns share the row instead of leaving a blank column.
  const breakdownCells = recentSection
    ? [
      <div key="recent" className={styles.column}>{recentSection}</div>,
      <div key="breakdowns" className={styles.column}>{verdictsSection}{languagesSection}</div>,
    ]
    : [verdictsSection, languagesSection]
      .filter(Boolean)
      .map((section, i) => <div key={i} className={styles.column}>{section}</div>);

  return (
    <div className={styles['profile-container']}>
      <div className={styles['profile-header']}>
        {isOwnProfile ? (
          <button
            type="button"
            className={styles['avatar-button']}
            aria-label="Change avatar"
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarContent}
            <span className={styles['avatar-overlay']} aria-hidden="true">
              <PencilSimple size={20} weight="fill" />
              Change
            </span>
          </button>
        ) : (
          avatarContent
        )}
        {/* Identity, then level: name, a meta line, and the XP bar under them. */}
        <div className={styles['profile-title']}>
          <h1>{profile.username}</h1>
          <p className={styles['profile-meta']}>
            {profile.progression && (
              <span className={styles['tier-level']}>{`${profile.progression.tier} · Lv ${profile.progression.level}`}</span>
            )}
            <span className={styles['profile-joined']}>
              Joined {formatDate(profile.createdAt)}
            </span>
          </p>
          {profile.progression && (
            <div className={styles['progression']}>
              <span className={styles['progression-bar']}>
                <ProgressBar
                  value={profile.progression.levelProgress.current}
                  max={profile.progression.levelProgress.required}
                  label={`XP to next level: ${profile.progression.levelProgress.remaining} XP remaining`}
                />
              </span>
              <span className={styles['xp-total']}>
                {`${formatXp(profile.progression.levelProgress.current)} / ${formatXp(profile.progression.levelProgress.required)} XP`}
              </span>
              <span className={styles['xp-remaining']}>
                {`${formatXp(profile.progression.levelProgress.remaining)} XP to Lv ${profile.progression.level + 1}`}
              </span>
            </div>
          )}
        </div>
        {profile.progression?.globalRank != null && (
          <div className={styles['rank']}>
            <span>Global rank</span>
            <b>{`#${profile.progression.globalRank}`}</b>
          </div>
        )}
        {isOwnProfile && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className={styles['avatar-input']}
            onChange={handleAvatarSelected}
          />
        )}
      </div>

      <ul className={styles['stat-row']} aria-label="Stats">
        <li><span>Solved</span><b>{profile.problemsSolved}</b></li>
        <li><span>Attempted</span><b>{profile.problemsAttempted}</b></li>
        <li><span>Submissions</span><b>{profile.submissionCount.toLocaleString()}</b></li>
        <li><span>Current run</span><b>{`${profile.currentStreak} ${profile.currentStreak === 1 ? 'day' : 'days'}`}</b></li>
        <li><span>Best run</span><b>{`${profile.longestStreak} ${profile.longestStreak === 1 ? 'day' : 'days'}`}</b></li>
      </ul>

      <div className={styles.section}>
        <h2>Activity</h2>
        <ActivityHeatmap activity={profile.dailyActivity} />
      </div>

      <ProblemSolvingProfile categories={profile.categoryStats} />

      {breakdownCells.length > 0 && (
        <div className={styles['two-col']}>{breakdownCells}</div>
      )}

      <Achievements stats={profile.achievements.stats} unlockedIds={unlockedIds} />
    </div>
  );
};

export default UserProfile;
