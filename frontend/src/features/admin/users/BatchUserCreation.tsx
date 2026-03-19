import useBatchUserCreation from '../../../hooks/admin/useBatchUserCreation';
import styles from '../shared/Management.module.css';
import formStyles from '../../../components/styles/Form.module.css';
import tableStyles from '../../../components/styles/Table.module.css';

interface BatchUserCreationProps {
  onUsersCreated: () => void;
}

const BatchUserCreation = ({ onUsersCreated }: BatchUserCreationProps) => {
  const {
    prefix,
    setPrefix,
    count,
    setCount,
    isLoading,
    error,
    createdUsers,
    generateAndDownloadCsv,
    handleSubmit
  } = useBatchUserCreation(onUsersCreated);

  return (
    <div className={styles['management-container']} style={{ marginTop: '2rem' }}>
      <div className={styles['management-header']}>
        <h2>Batch User Creation</h2>
      </div>
      <form onSubmit={handleSubmit} className={formStyles.form}>
        <div className={formStyles['form-group']}>
          <label htmlFor="prefix">Username Prefix</label>
          <input
            type="text"
            id="prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            required
            placeholder="e.g., student"
          />
        </div>
        <div className={formStyles['form-group']}>
          <label htmlFor="count">Number of Users</label>
          <input
            type="number"
            id="count"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            required
            min="1"
            max="100"
          />
        </div>
        <button type="submit" disabled={isLoading} className={formStyles['submit-button']}>
          {isLoading ? 'Generating...' : 'Generate Users'}
        </button>
        {error && <p className={formStyles['error-message']}>{error}</p>}
      </form>

      {createdUsers && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className={styles['management-header']}>
            <h3>Generated Users & Passwords</h3>
            <button onClick={generateAndDownloadCsv} className={styles['create-btn']}>
              Download CSV
            </button>
          </div>
          <p>Please save these passwords. They will not be shown again.</p>
          <div className={tableStyles['table-container']}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {createdUsers.map((user: { username: string; password: string }) => (
                  <tr key={user.username}>
                    <td>{user.username}</td>
                    <td>{user.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchUserCreation;
