import { useState } from 'react';
import OverviewTab from './OverviewTab';
import UsersTab from './UsersTab';
import UserDetail from './UserDetail';
import ProblemsTab from './ProblemsTab';
import ProblemDetail from './ProblemDetail';
import styles from './AnalysisPage.module.css';

type AnalysisTab = 'overview' | 'users' | 'problems';

const TABS: Array<{ key: AnalysisTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'problems', label: 'Problems' },
];

const AnalysisPage = () => {
  const [tab, setTab] = useState<AnalysisTab>('overview');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);

  const handleSelectUser = (userId: number) => {
    setSelectedUserId(userId);
  };

  const handleBackToUsers = () => {
    setSelectedUserId(null);
  };

  const handleSelectProblem = (problemId: string) => {
    setSelectedProblemId(problemId);
  };

  const handleBackToProblems = () => {
    setSelectedProblemId(null);
  };

  const switchTab = (key: AnalysisTab) => {
    setTab(key);
    setSelectedUserId(null);
    setSelectedProblemId(null);
  };

  return (
    <div className={styles.container}>
      <h2>Analysis</h2>
      <div className={styles.tabs} role="tablist" aria-label="Analysis sections">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles['tab-active'] : styles.tab}
            onClick={() => switchTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && (
        selectedUserId === null
          ? <UsersTab onSelectUser={handleSelectUser} />
          : <UserDetail userId={selectedUserId} onBack={handleBackToUsers} />
      )}
      {tab === 'problems' && (
        selectedProblemId === null
          ? <ProblemsTab onSelectProblem={handleSelectProblem} />
          : <ProblemDetail problemId={selectedProblemId} onBack={handleBackToProblems} />
      )}
    </div>
  );
};

export default AnalysisPage;

