import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { InlineError, ProgressBar } from '../../components/ui';
import { isEditableTarget, isModalOpen } from '../../components/shell/keyboard';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import AuthRequired from '../../components/shared/AuthRequired';
import GuestHome from '../../features/home/GuestHome';
import CollectionsPanel from '../../features/home/CollectionsPanel';
import ContinueBlock from '../../features/home/ContinueBlock';
import WeekStrip from '../../features/home/WeekStrip';
import WithinReach from '../../features/home/WithinReach';
import RecentSubmissions from '../../features/home/RecentSubmissions';
import WeeklyLeaders from '../../features/home/WeeklyLeaders';
import ContestsPanel from '../../features/home/ContestsPanel';
import parts from '../../features/home/Home.parts.module.css';
import contestService from '../../services/contestService';
import homeService from '../../services/homeService';
import type { Contest, HomeSummary } from '../../types';
import styles from './Home.module.css';

const DATE_LINE = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

/** Enter on the page body (not a control, not inside a dialog) opens the continue problem. */
const isPageLevelEnter = (event: KeyboardEvent): boolean => {
  if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (isEditableTarget(event.target) || isModalOpen()) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest?.('a, button, [role="button"], [role="menuitem"]');
};

const Home = () => {
  const { user } = useAuth();
  const { isPrivateMode } = useSettings();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [contests, setContests] = useState<Contest[]>([]);

  const loadSummary = useCallback(() => {
    setFailed(false);
    homeService.getHome()
      .then(setSummary)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    homeService.getHome()
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    contestService.getAll()
      .then((data) => { if (!cancelled) setContests(data); })
      .catch(() => { if (!cancelled) setContests([]); });
    return () => { cancelled = true; };
  }, [user]);

  const continueId = summary?.continue?.id ?? null;
  useEffect(() => {
    if (!continueId) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPageLevelEnter(event)) return;
      event.preventDefault();
      navigate(`/problems/${continueId}`);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [continueId, navigate]);

  if (!user) {
    return isPrivateMode ? <AuthRequired /> : <GuestHome />;
  }

  const progression = summary?.progression;

  return (
    <div className={styles['home-container']}>
      <header className={styles.header}>
        <p className={styles.dateLine}>{DATE_LINE.format(new Date())}</p>
        <h1 className={styles.title}>Continue where you left off</h1>
      </header>

      {failed && <InlineError message="Couldn't load your progress." onRetry={loadSummary} />}

      {summary && (
        <div className={styles.columns}>
          <div className={styles.main}>
            <ContinueBlock
              next={summary.continue}
              startWith={summary.startWith}
              onContinue={(id) => navigate(`/problems/${id}`)}
            />
            <WithinReach summary={summary} />
            <RecentSubmissions />
            <WeeklyLeaders username={user.username} />
          </div>

          <aside className={styles.aside}>
            {progression && (
              <section className={parts.panel} aria-labelledby="home-level">
                <h2 id="home-level" className={parts.sectionLabel}>Level</h2>
                <p className={styles.level}>{`Lv.${progression.level} · ${progression.tier}`}</p>
                <ProgressBar
                  value={progression.levelProgress.current}
                  max={progression.levelProgress.required}
                  label={`${progression.levelProgress.remaining} XP to Lv.${progression.level + 1}`}
                />
                <p className={parts.meta}>
                  <span className={styles.mono}>{`${progression.levelProgress.current} / ${progression.levelProgress.required} XP`}</span>
                  <span>{`${progression.levelProgress.remaining} XP to Lv.${progression.level + 1}`}</span>
                </p>
              </section>
            )}

            <section className={parts.panel} aria-labelledby="home-week">
              <h2 id="home-week" className={parts.sectionLabel}>This week</h2>
              <WeekStrip week={summary.week} currentStreak={summary.currentStreak} />
            </section>

            <CollectionsPanel collections={summary.collections} />

            <ContestsPanel contests={contests} />
          </aside>
        </div>
      )}
    </div>
  );
};

export default Home;
