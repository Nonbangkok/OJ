import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ContestModal from './ContestModal';
import ProblemMigrationModal from './ProblemMigrationModal';
import ConfirmationModal from './ConfirmationModal';
import styles from './Management.module.css';

const API_URL = process.env.REACT_APP_API_URL;

function ContestManagement({ currentUser }) {
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContest, setEditingContest] = useState(null);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [migrationContest, setMigrationContest] = useState(null);
  
  // Confirmation modal
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [contestToDelete, setContestToDelete] = useState(null);
  
  useEffect(() => {
    fetchContests();
  }, []);

  const fetchContests = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/admin/contests`, {
        withCredentials: true
      });
      setContests(response.data);
    } catch (err) {
      console.error('Error fetching contests:', err);
      setError('Failed to load contests');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (contestToDelete) {
      try {
        await axios.delete(`${API_URL}/admin/contests/${contestToDelete}`, {
          withCredentials: true
        });
        fetchContests();
        setIsConfirmModalOpen(false);
        setContestToDelete(null);
      } catch (err) {
        console.error('Error deleting contest:', err);
        setError(err.response?.data?.message || 'Failed to delete contest');
      }
    }
  };

  const handleEdit = (contest) => {
    setEditingContest(contest);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingContest(null);
    setIsModalOpen(true);
  };

  const handleManageProblems = (contest) => {
    setMigrationContest(contest);
    setIsMigrationModalOpen(true);
  };

  const getStatusBadge = (status) => {
    const statusClasses = {
      'scheduled': `${styles.badge} ${styles.scheduled}`,
      'running': `${styles.badge} ${styles.running}`,
      'finishing': `${styles.badge} ${styles.finishing}`,
      'finished': `${styles.badge} ${styles.finished}`
    };
    
    const statusText = {
      'scheduled': 'Scheduled',
      'running': 'Running',
      'finishing': 'Finishing',
      'finished': 'Finished'
    };

    return (
      <span className={statusClasses[status] || styles.badge}>
        {statusText[status] || status}
      </span>
    );
  };

  const formatDateTime = (dateTime) => {
    return new Date(dateTime).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return <div className={styles.loading}>Loading contests...</div>;
  }

  return (
    <div className={styles['management-container']}>
      <div className={styles['management-header']}>
        <h2>Contest Management</h2>
        <div className={styles['header-actions']}>
          <button 
            onClick={handleCreate}
            className={styles['create-btn']}
          >
            Create New Contest
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.error}>
          <h3>Error: {error}</h3>
        </div>
      )}

      {/* Contests Table */}
      {contests.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🏆</div>
          <h3>No contests yet</h3>
          <p>Create your first contest to get started</p>
          <button 
            onClick={handleCreate}
            className={styles['create-btn']}
          >
            Create First Contest
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Start Time</th>
                <th>Participants</th>
                <th>Problems</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contests.map(contest => (
                <tr key={contest.id}>
                  <td>
                    {contest.title}
                  </td>
                  
                  <td>
                    {getStatusBadge(contest.status)}
                  </td>
                  
                  <td>
                    <div className={styles.timeInfo}>
                      <div className={styles.timeRow}>
                        <span className={styles.timeLabel}>Start:</span>
                        <span className={styles.timeValue}>
                          {formatDateTime(contest.start_time)}
                        </span>
                      </div>
                      <div className={styles.timeRow}>
                        <span className={styles.timeLabel}>End:</span>
                        <span className={styles.timeValue}>
                          {formatDateTime(contest.end_time)}
                        </span>
                      </div>
                    </div>
                  </td>
                  
                  <td>
                    <span className={styles.statValue}>
                      {contest.participant_count || 0}
                    </span>
                  </td>
                  
                  <td>
                    <span className={styles.statValue}>
                      {contest.problem_count || 0}
                    </span>
                  </td>
                  
                  <td>
                    <div className={styles.actionButtons}>
                      <button
                        onClick={() => handleEdit(contest)}
                        className={styles['edit-btn']}
                        title="Edit Contest"
                      >
                        Edit
                      </button>
                      
                      <button
                        onClick={() => handleManageProblems(contest)}
                        className={styles['problems-btn']}
                        title="Manage Problems"
                        disabled={contest.status === 'running' || contest.status === 'finished'}
                      >
                        Problems
                      </button>
                      
                      <button
                        onClick={() => {
                          setContestToDelete(contest.id);
                          setIsConfirmModalOpen(true);
                        }}
                        className={styles['delete-btn']}
                        title="Delete Contest"
                        disabled={contest.status === 'running'}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Contest Modal */}
      {isModalOpen && (
        <ContestModal
          contest={editingContest}
          onClose={() => {
            setIsModalOpen(false);
            setEditingContest(null);
          }}
          onSuccess={() => {
            fetchContests();
            setIsModalOpen(false);
            setEditingContest(null);
          }}
        />
      )}

      {/* Problem Migration Modal */}
      {isMigrationModalOpen && migrationContest && (
        <ProblemMigrationModal
          contest={migrationContest}
          onClose={() => {
            setIsMigrationModalOpen(false);
            setMigrationContest(null);
          }}
          onSuccess={() => {
            fetchContests();
            setIsMigrationModalOpen(false);
            setMigrationContest(null);
          }}
        />
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <ConfirmationModal
          isOpen={isConfirmModalOpen}
          onClose={() => {
            setIsConfirmModalOpen(false);
            setContestToDelete(null);
          }}
          onConfirm={handleDelete}
          title="Delete Contest"
          message="Are you sure you want to delete this contest? This action cannot be undone."
          confirmText="Delete"
          confirmStyle="danger"
        />
      )}
    </div>
  );
}

export default ContestManagement; 