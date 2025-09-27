import React, { useState, useEffect } from 'react';
import axios from 'axios';
import formStyles from '../Form.module.css';
import modalStyles from './ModalLayout.module.css';

const API_URL = process.env.REACT_APP_API_URL;

function ProblemMigrationModal({ contest, onClose, onSuccess }) {
  const [availableProblems, setAvailableProblems] = useState([]);
  const [contestProblems, setContestProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAvailable, setSelectedAvailable] = useState([]);
  const [selectedContest, setSelectedContest] = useState([]);

  useEffect(() => {
    fetchProblems();
  }, [contest.id]);

  const fetchProblems = async () => {
    try {
      setLoading(true);
      
      // Fetch available problems and contest problems in parallel
      const [availableRes, contestRes] = await Promise.all([
        axios.get(`${API_URL}/contests/available-problems`, {
          withCredentials: true
        }),
        axios.get(`${API_URL}/admin/contests/${contest.id}/admin-problems`, {
          withCredentials: true
        })
      ]);
      
      setAvailableProblems(availableRes.data);
      setContestProblems(contestRes.data);
    } catch (err) {
      console.error('Error fetching problems:', err);
      setError('Failed to load problems');
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToContest = async () => {
    if (selectedAvailable.length === 0) return;
    
    try {
      setMigrationLoading(true);
      setError('');
      
      await axios.post(`${API_URL}/admin/contests/${contest.id}/problems`, {
        problemIds: selectedAvailable,
        action: 'move_to_contest'
      }, {
        withCredentials: true
      });
      
      setSelectedAvailable([]);
      await fetchProblems(); // Refresh both lists
    } catch (err) {
      console.error('Error moving problems to contest:', err);
      setError(err.response?.data?.message || 'Failed to move problems to contest');
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleMoveToMain = async (problemId) => {
    const problemIdsToRemove = problemId ? [problemId] : selectedContest;

    if (problemIdsToRemove.length === 0) {
      return;
    }

    try {
      setMigrationLoading(true);
      setError('');
      
      await axios.post(`${API_URL}/admin/contests/${contest.id}/problems`, {
        problemIds: problemIdsToRemove,
        action: 'move_to_main'
      }, {
        withCredentials: true
      });
      
      setSelectedContest([]); // Clear selection after moving
      await fetchProblems(); // Refresh both lists
    } catch (err) {
      console.error('Error moving problems to main:', err);
      setError(err.response?.data?.message || 'Failed to move problems to main');
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleSelectAvailable = (problemId) => {
    setSelectedAvailable(prev => 
      prev.includes(problemId)
        ? prev.filter(id => id !== problemId)
        : [...prev, problemId]
    );
  };

  const handleSelectContest = (problemId) => {
    setSelectedContest(prev => 
      prev.includes(problemId)
        ? prev.filter(id => id !== problemId)
        : [...prev, problemId]
    );
  };

  const handleSelectAllAvailable = () => {
    if (selectedAvailable.length === availableProblems.length) {
      setSelectedAvailable([]);
    } else {
      setSelectedAvailable(availableProblems.map(p => p.id));
    }
  };

  const handleSelectAllContest = () => {
    if (selectedContest.length === contestProblems.length) {
      setSelectedContest([]);
    } else {
      setSelectedContest(contestProblems.map(p => p.id));
    }
  };

  const canMoveProblems = contest.status === 'scheduled' || contest.status === 'running';

  if (loading) {
    return (
      <div className={modalStyles['modal-overlay']}>
        <div className={`${formStyles['form-container']} ${modalStyles.migrationModalContainer}`}>
          <h2>📝 Manage Contest Problems</h2>
          <div className={modalStyles.migrationModalLoadingText}>
            Loading problems...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={modalStyles['modal-overlay']} onClick={onClose}>
      <div 
        className={`${formStyles['form-container']} ${modalStyles.migrationModalContainer}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={modalStyles.migrationModalHeader}>
          <h2>Manage Contest Problems</h2>
          <p>Contest: <strong>{contest.title}</strong></p>
        </div>
        
        {error && (
          <div className={formStyles['error-message']}>
            <h3>Error: {error}</h3>
          </div>
        )}
        
        {contest.status !== 'scheduled' && contest.status !== 'running' && (
          <div className={modalStyles.migrationModalWarning}>
            Problems can only be modified for scheduled or running contests.
            This contest is currently {contest.status}.
          </div>
        )}

        <div className={modalStyles.migrationModalGrid}>
          {/* Available Problems */}
          <div className={modalStyles.migrationPanel}>
            <div className={modalStyles.migrationPanelHeader}>
              <h3>Available Problems ({availableProblems.length})</h3>
              {canMoveProblems && availableProblems.length > 0 && (
                <button
                  onClick={handleSelectAllAvailable}
                  className={modalStyles.migrationSelectAllButton}
                >
                  {selectedAvailable.length === availableProblems.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
            
            <div className={modalStyles.migrationProblemList}>
              {availableProblems.length === 0 ? (
                <div className={modalStyles.migrationEmptyList}>
                  <h3>No Available Problems</h3>
                </div>
              ) : (
                availableProblems.map(problem => {
                  const itemClasses = [
                    modalStyles.migrationProblemItem,
                    canMoveProblems ? modalStyles.enabled : modalStyles.disabled,
                    selectedAvailable.includes(problem.id) ? modalStyles.selected : ''
                  ].join(' ');

                  return (
                    <div
                      key={problem.id}
                      className={itemClasses}
                      onClick={() => canMoveProblems && handleSelectAvailable(problem.id)}
                    >
                      <div className={modalStyles.migrationProblemDetails}>
                        <h4 className={modalStyles.migrationProblemTitle}>
                          {problem.title}
                        </h4>
                        <p className={modalStyles.migrationProblemAuthor}>by {problem.author}</p>
                      </div>
                      {canMoveProblems && (
                        <div className={modalStyles.migrationProblemCheckboxContainer}>
                          <input
                            type="checkbox"
                            checked={selectedAvailable.includes(problem.id)}
                            onChange={() => handleSelectAvailable(problem.id)}
                            onClick={e => e.stopPropagation()}
                            className={modalStyles.migrationProblemCheckbox}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Migration Controls */}
          <div className={modalStyles.migrationControls}>
            <div className={modalStyles.migrationControlsButtons}>
              <button
                onClick={handleMoveToContest}
                disabled={!canMoveProblems || selectedAvailable.length === 0 || migrationLoading}
                className={`${modalStyles.migrationControlButton} ${modalStyles.migrationControlToAdd}`}
                title="Move selected problems to contest"
              >
                <small className={modalStyles.migrationControlButtonText}>Add to Contest</small>
              </button>
              
              <button
                onClick={() => handleMoveToMain()}
                disabled={!canMoveProblems || selectedContest.length === 0 || migrationLoading}
                className={`${modalStyles.migrationControlButton} ${modalStyles.migrationControlToRemove}`}
                title="Move selected problems back to main pool"
              >
                <small className={modalStyles.migrationControlButtonText}>Remove from Contest</small>
              </button>
            </div>
            
            <div className={modalStyles.migrationSelectionCountContainer}>
              <div className={modalStyles.migrationSelectionCountText}>
                {selectedAvailable.length} selected from available
              </div>
              <div className={modalStyles.migrationSelectionCountText}>
                {selectedContest.length} selected from contest
              </div>
            </div>
          </div>

          {/* Contest Problems */}
          <div className={modalStyles.migrationPanel}>
            <div className={modalStyles.migrationPanelHeader}>
              <div>
                <h3>Contest Problems ({contestProblems.length})</h3>
              </div>
              {canMoveProblems && contestProblems.length > 0 && (
                <button
                  onClick={handleSelectAllContest}
                  className={modalStyles.migrationSelectAllButton}
                >
                  {selectedContest.length === contestProblems.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className={modalStyles.migrationProblemList}>
              {contestProblems.length === 0 ? (
                <div className={modalStyles.migrationEmptyList}>
                  <h3>No Contest Problems</h3>
                  <p>No problems have been assigned to this contest yet</p>
                </div>
              ) : (
                contestProblems.map((problem) => {
                  const itemClasses = [
                    modalStyles.migrationProblemItem,
                    canMoveProblems ? modalStyles.enabled : modalStyles.disabled,
                    selectedContest.includes(problem.id) ? modalStyles.selected : ''
                  ].join(' ');
                  
                  return (
                    <div
                      key={problem.id}
                      className={itemClasses}
                      onClick={() => canMoveProblems && handleSelectContest(problem.id)}
                    >
                      <div className={modalStyles.migrationProblemDetails}>
                        <h4 className={modalStyles.migrationProblemTitle}>
                          {problem.title}
                        </h4>
                        <p className={modalStyles.migrationProblemAuthor}>by {problem.author}</p>
                      </div>
                      {canMoveProblems && (
                        <div className={modalStyles.migrationProblemCheckboxContainer}>
                          <input
                            type="checkbox"
                            checked={selectedContest.includes(problem.id)}
                            onChange={() => handleSelectContest(problem.id)}
                            onClick={e => e.stopPropagation()}
                            className={modalStyles.migrationProblemCheckbox}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className={modalStyles.migrationFooter}>
          <button
            onClick={onClose}
            className={modalStyles.migrationCloseButton}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProblemMigrationModal; 