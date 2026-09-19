import { useEffect, useState } from 'react';
import { AdminProblem } from '../../../types';
import problemsAdminService from '../../../services/admin/problemsAdminService';
import styles from './ProblemsTab.module.css';

interface ProblemsTabProps {
  onSelectProblem: (problemId: string) => void;
}

const ProblemsTab = ({ onSelectProblem }: ProblemsTabProps) => {
  const [problems, setProblems] = useState<AdminProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await problemsAdminService.getProblems();
        if (!cancelled) setProblems(result);
      } catch {
        if (!cancelled) setError('Failed to load problems. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading) return <p className={styles.loading}>Loading problems…</p>;

  return (
    <div className={styles['table-card']}>
      <table>
        <thead>
          <tr>
            <th>Problem</th>
            <th>Category</th>
            <th>Visibility</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => (
            <tr key={problem.id}>
              <td>{problem.title}</td>
              <td>{problem.category ?? '—'}</td>
              <td>{problem.is_visible ? 'Visible' : 'Hidden'}</td>
              <td>
                <button
                  type="button"
                  className={styles['analyze-button']}
                  onClick={() => onSelectProblem(problem.id)}
                >
                  Analyze {problem.title}
                </button>
              </td>
            </tr>
          ))}
          {problems.length === 0 && (
            <tr><td colSpan={4} className={styles.empty}>No problems found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ProblemsTab;
