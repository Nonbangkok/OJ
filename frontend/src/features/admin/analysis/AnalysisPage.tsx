import { useState } from 'react';
import OverviewTab from './OverviewTab';
import UsersTab from './UsersTab';
import UserDetail from './UserDetail';
import UserCompare from './UserCompare';
import ProblemsTab from './ProblemsTab';
import ProblemDetail from './ProblemDetail';
import ContestsTab from './ContestsTab';
import ContestDetail from './ContestDetail';
import SubmissionsTab from './SubmissionsTab';
import styles from './AnalysisPage.module.css';

type AnalysisTab = 'overview' | 'users' | 'problems' | 'contests' | 'submissions';

const TABS: Array<{ key: AnalysisTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'problems', label: 'Problems' },
  { key: 'contests', label: 'Contests' },
  { key: 'submissions', label: 'Submissions' },
];

const AnalysisPage = () => {
  const [tab, setTab] = useState<AnalysisTab>('overview');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [compareUserIds, setCompareUserIds] = useState<[number, number] | null>(null);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [selectedContestId, setSelectedContestId] = useState<number | null>(null);

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

  const handleSelectContest = (contestId: number) => {
    setSelectedContestId(contestId);
  };

  const handleBackToContests = () => {
    setSelectedContestId(null);
  };

  // Cross-navigation from the submissions table into a detail view.
  const handleShowUser = (userId: number) => {
    setSelectedUserId(userId);
    setTab('users');
  };

  const handleShowProblem = (problemId: string) => {
    setSelectedProblemId(problemId);
    setTab('problems');
  };

  const handleCompareUsers = (userIds: [number, number]) => {
    setCompareUserIds(userIds);
    setSelectedUserId(null);
  };

  const switchTab = (key: AnalysisTab) => {
    setTab(key);
    setSelectedUserId(null);
    setCompareUserIds(null);
    setSelectedProblemId(null);
    setSelectedContestId(null);
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
        compareUserIds !== null
          ? <UserCompare userIds={compareUserIds} onBack={() => setCompareUserIds(null)} />
          : selectedUserId === null
            ? <UsersTab onSelectUser={handleSelectUser} onCompareUsers={handleCompareUsers} />
            : <UserDetail userId={selectedUserId} onBack={handleBackToUsers} />
      )}
      {tab === 'problems' && (
        selectedProblemId === null
          ? <ProblemsTab onSelectProblem={handleSelectProblem} />
          : <ProblemDetail problemId={selectedProblemId} onBack={handleBackToProblems} />
      )}
      {tab === 'contests' && (
        selectedContestId === null
          ? <ContestsTab onSelectContest={handleSelectContest} />
          : <ContestDetail contestId={selectedContestId} onBack={handleBackToContests} />
      )}
      {tab === 'submissions' && (
        <SubmissionsTab onSelectUser={handleShowUser} onSelectProblem={handleShowProblem} />
      )}
    </div>
  );
};

export default AnalysisPage;

