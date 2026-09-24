import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import ActivityHeatmap from '../../components/user/ActivityHeatmap';
import ProblemSolvingProfile from '../../features/user/ProblemSolvingProfile';
import LoadingPage from '../../components/shared/LoadingPage';
import { useAuth } from '../../context/AuthContext';
import userService from '../../services/userService';
import {
  ACHIEVEMENT_CATALOG,
  progressFraction,
  progressLabel,
} from '../../utils/achievements';

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

const verdictBarWidthFor = (counts: Record<string, number>) => makeBarWidth(counts);
const languageBarWidthFor = (counts: Record<string, number>) => makeBarWidth(counts);

const formatAcDate = (iso: string | null): string =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

const UserProfile = () => {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof userService.getProfile>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

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
  const solveRate = profile.problemsAttempted > 0
    ? Math.round((profile.problemsSolved / profile.problemsAttempted) * 100)
    : 0;
  const avatarVersion = profile.avatarUpdatedAt
    ? `?v=${new Date(profile.avatarUpdatedAt).getTime()}`
    : '';
  const verdictBarWidth = makeBarWidth(profile.verdictCounts);
  const languageBarWidth = makeBarWidth(profile.languageCounts);

  const unlockedIds = new Set(profile.achievements.unlocked.map((achievement) => achievement.id));

  return (
    <div className={styles['profile-container']}>
      <div className={styles['profile-header']}>
        {profile.hasAvatar ? (
          <img
            className={styles['profile-avatar']}
            src={`${process.env.REACT_APP_API_URL}/users/${profile.username}/avatar${avatarVersion}`}
            alt={`${profile.username}'s avatar`}
          />
        ) : (
          <span className={styles['profile-avatar']} aria-hidden="true">
            {profile.username[0]?.toLocaleUpperCase()}
          </span>
        )}
        <div className={styles['profile-title']}>
          <h1>{profile.username}</h1>
          <span className={styles['profile-joined']}>
            Joined {formatDate(profile.createdAt)}
          </span>
        </div>
        {profile.progression && (
          <div className={styles['progression']}>
            <div className={styles['progression-tier']}>
              <span className={styles['tier-badge']}>{profile.progression.tier}</span>
              <span className={styles['tier-level']}>Level {profile.progression.level}</span>
            </div>
            <div className={styles['progression-xp']}>
              <span className={styles['xp-total']}>{formatXp(profile.progression.totalXp)} XP</span>
              <span
                className={styles['xp-bar']}
                role="progressbar"
                aria-label={`XP to next level: ${profile.progression.levelProgress.remaining} XP remaining`}
                aria-valuemin={0}
                aria-valuemax={profile.progression.levelProgress.required}
                aria-valuenow={profile.progression.levelProgress.current}
              >
                <span
                  className={styles['xp-bar-fill']}
                  style={{ width: `${profile.progression.levelProgress.percentage}%` }}
                />
              </span>
              <span className={styles['xp-remaining']}>
                {formatXp(profile.progression.levelProgress.remaining)} XP to Level {profile.progression.level + 1}
              </span>
            </div>
            {profile.progression.globalRank !== null && (
              <span className={styles['rank-badge']}>
                Rank #{profile.progression.globalRank}
              </span>
            )}
          </div>
        )}
        {isOwnProfile && (
          <>
            <button
              type="button"
              className={`${styles['change-avatar-button']} button button-secondary`}
              onClick={() => fileInputRef.current?.click()}
            >
              Change Avatar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={styles['avatar-input']}
              onChange={handleAvatarSelected}
            />
          </>
        )}
      </div>

      <div className={styles['stats-grid']}>
        <div className={styles['stat-card']}>
          <span className={styles['stat-value']}>{profile.problemsSolved}</span>
          <span className={styles['stat-label']}>Solved</span>
        </div>
        <div className={styles['stat-card']}>
          <span className={styles['stat-value']}>{profile.problemsAttempted}</span>
          <span className={styles['stat-label']}>Attempted</span>
        </div>
        <div className={styles['stat-card']}>
          <span className={styles['stat-value']}>{profile.totalScore}</span>
          <span className={styles['stat-label']}>Total score</span>
        </div>
        <div className={styles['stat-card']}>
          <span className={styles['stat-value']}>{profile.submissionCount}</span>
          <span className={styles['stat-label']}>Submissions</span>
        </div>
        <div className={styles['stat-card']}>
          <span className={styles['stat-value']}>{solveRate}%</span>
          <span className={styles['stat-label']}>Solve rate</span>
        </div>
      </div>

      {profile.recentRewards?.length > 0 && (
        <div className={styles.section}>
          <h2>Recent XP</h2>
          <ul className={styles['recent-xp-list']}>
            {profile.recentRewards.slice(0, 5).map((reward) => (
              <li key={`${reward.problemId}-${reward.awardedAt}`} className={styles['recent-xp-row']}>
                <span className={styles['recent-xp-gain']}>+{reward.xpAwarded} XP</span>
                <span className={styles['recent-xp-problem']}>
                  {reward.problemTitle ?? reward.problemId}
                </span>
                {reward.difficultySnapshot !== null && (
                  <span className={styles['recent-xp-difficulty']}>
                    {reward.difficultySnapshot}
                  </span>
                )}
                <span className={styles['recent-xp-date']}>
                  {formatRewardDate(reward.awardedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.section}>
        <h2>Activity</h2>
        <ActivityHeatmap activity={profile.dailyActivity} />
      </div>

      <div className={styles['streak-panel']}>
        <span className={styles['streak-flame']} aria-hidden="true" />
        <div className={styles['streak-body']}>
          <span className={styles['streak-count']}>
            {profile.currentStreak}
          </span>
          <span className={styles['streak-unit']}>
            day streak
            {profile.currentStreak > 0 && profile.lastAcDate && (
              <span className={styles['streak-last']}> — last AC {formatAcDate(profile.lastAcDate)}</span>
            )}
          </span>
        </div>
        <span className={styles['streak-longest']}>
          Longest streak: <strong>{profile.longestStreak}</strong> {profile.longestStreak === 1 ? 'day' : 'days'}
        </span>
      </div>

      <ProblemSolvingProfile categories={profile.categoryStats} />

      <div className={styles.section}>
        <h2>Achievements</h2>
        <div className={styles['achievements-grid']}>
          {ACHIEVEMENT_CATALOG.map((achievement) => {
            const unlocked = unlockedIds.has(achievement.id);
            const label = progressLabel(achievement, profile.achievements.stats);
            const fraction = progressFraction(achievement, profile.achievements.stats);
            return (
              <div
                key={achievement.id}
                className={`${styles['achievement-card']} ${unlocked ? styles.unlocked : styles.locked}`}
              >
                <div className={styles['achievement-head']}>
                  <span className={styles['achievement-icon']} aria-hidden="true" />
                  {!unlocked && <span className={styles['achievement-lock']}>Locked</span>}
                </div>
                <span className={styles['achievement-name']}>{achievement.name}</span>
                <span className={styles['achievement-description']}>{achievement.description}</span>
                {!unlocked && (
                  <>
                    <span className={styles['achievement-progress']} aria-hidden="true">
                      <span
                        className={styles['achievement-progress-fill']}
                        style={{ width: `${Math.round(fraction * 100)}%` }}
                      />
                    </span>
                    <span className={styles['achievement-progress-label']}>
                      {label ?? 'Not yet started'}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles['two-col']}>
        {Object.keys(profile.verdictCounts).length > 0 && (
          <div className={styles.section}>
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
          </div>
        )}

        {Object.keys(profile.languageCounts).length > 0 && (
          <div className={styles.section}>
            <h2>Languages</h2>
            <ul className={styles['breakdown-list']}>
              {Object.entries(profile.languageCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([language, count]) => (
                  <li key={language} className={styles['breakdown-row']}>
                    <span className={`${styles['breakdown-name']} ${styles['language-name']}`}>
                      {language}
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
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfile;
