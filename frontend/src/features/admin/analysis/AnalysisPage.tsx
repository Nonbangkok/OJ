import { useState } from 'react';
import OverviewTab from './OverviewTab';
import styles from './AnalysisPage.module.css';

type AnalysisTab = 'overview' | 'users' | 'problems';

const TABS: Array<{ key: AnalysisTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'problems', label: 'Problems' },
];

const AnalysisPage = () => {
  const [tab, setTab] = useState<AnalysisTab>('overview');

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
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
    </div>
  );
};

export default AnalysisPage;
