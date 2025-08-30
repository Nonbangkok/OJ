import React, { useState } from 'react';
import axios from 'axios';
import styles from './Management.module.css';
import formStyles from '../Form.module.css';

const API_URL = process.env.REACT_APP_API_URL;

const BatchUserCreation = ({ onUsersCreated }) => {
  const [prefix, setPrefix] = useState('');
  const [count, setCount] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdUsers, setCreatedUsers] = useState(null);

  const generateAndDownloadCsv = () => {
    if (!createdUsers || createdUsers.length === 0) return;

    const csvHeader = 'username,password\n';
    const csvRows = createdUsers.map(user => `"${user.username}","${user.password}"`).join('\n');
    const csvContent = csvHeader + csvRows;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    link.setAttribute('download', `${prefix || 'users'}_${timestamp}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setCreatedUsers(null);
    setIsLoading(true);

    if (count <= 0 || count > 100) {
      setError('Please enter a number between 1 and 100.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await axios.post(
        `${API_URL}/admin/users/batch`,
        { prefix, count: Number(count) },
        { withCredentials: true }
      );
      setCreatedUsers(response.data.users);
      // We do NOT call onUsersCreated() here to prevent the results table from disappearing.
      // The admin can manually refresh the page to see the updated main user list.
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create users.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

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
            onChange={(e) => setCount(e.target.value)}
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
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {createdUsers.map(user => (
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
