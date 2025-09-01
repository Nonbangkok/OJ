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
      onSuccess(); // Notify parent to refresh contest list
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

  const canMoveProblems = contest.status === 'scheduled';

  if (loading) {
    return (
      <div className={modalStyles['modal-overlay']}>
        <div className={formStyles['form-container']} style={{maxWidth: '1200px'}}>
          <h2>📝 Manage Contest Problems</h2>
          <div style={{textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)', fontSize: '1.1rem'}}>
            Loading problems...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={modalStyles['modal-overlay']} onClick={onClose}>
      <div 
        className={formStyles['form-container']} 
        style={{maxWidth: '1200px', width: '95%'}}
        onClick={e => e.stopPropagation()}
      >
        <h2>Manage Contest Problems</h2>
        <p>Move problems between the main system and this contest</p>
        
        {error && (
          <div className={formStyles['error-message']}>
            <h3>Error: {error}</h3>
          </div>
        )}
        
        {contest.status !== 'scheduled' && (
          <div style={{background: '#fff3cd', color: '#856404', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #ffc107'}}>
            Problems can only be modified for scheduled contests.
            This contest is currently {contest.status}.
          </div>
        )}

        <div style={{display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '20px', minHeight: '500px'}}>
          {/* Available Problems */}
          <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', paddingBottom: '10px', borderBottom: '2px solid var(--border-color)'}}>
              <h3>📚 Available Problems ({availableProblems.length})</h3>
              {canMoveProblems && availableProblems.length > 0 && (
                <button
                  onClick={handleSelectAllAvailable}
                  style={{padding: '6px 12px', fontSize: '0.8rem', backgroundColor: 'var(--background-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px'}}
                >
                  {selectedAvailable.length === availableProblems.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
            
            <div style={{flex: 1, maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)'}}>
              {availableProblems.length === 0 ? (
                <div style={{textAlign: 'center', padding: '40px 20px'}}>
                  <div style={{fontSize: '2.5rem', marginBottom: '15px'}}>📝</div>
                  <h3>No Available Problems</h3>
                  <p>All problems are already assigned to this contest</p>
                </div>
              ) : (
                availableProblems.map(problem => (
                  <div
                    key={problem.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--border-color)',
                      cursor: canMoveProblems ? 'pointer' : 'not-allowed',
                      transition: 'background-color 0.2s ease',
                      position: 'relative',
                      background: selectedAvailable.includes(problem.id) ? '#e3f2fd' : 'transparent',
                      borderColor: selectedAvailable.includes(problem.id) ? '#1976d2' : 'var(--border-color)',
                      opacity: canMoveProblems ? 1 : 0.6
                    }}
                    onClick={() => canMoveProblems && handleSelectAvailable(problem.id)}
                  >
                    <div style={{flex: 1, minWidth: 0}}>
                      <h4 style={{margin: '0 0 4px 0', color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        {problem.title}
                      </h4>
                      <p style={{margin: '0 0 8px 0', color: 'var(--text-secondary)', fontSize: '0.8rem'}}>by {problem.author}</p>
                      <div style={{display: 'flex', gap: '12px'}}>
                        <span style={{color: 'var(--text-secondary)', fontSize: '0.75rem', background: 'var(--card-bg)', padding: '2px 6px', borderRadius: '4px'}}>
                          ⏱️ {problem.time_limit_ms || 2000}ms
                        </span>
                        <span style={{color: 'var(--text-secondary)', fontSize: '0.75rem', background: 'var(--card-bg)', padding: '2px 6px', borderRadius: '4px'}}>
                          💾 {problem.memory_limit_mb || 256}MB
                        </span>
                      </div>
                    </div>
                    {canMoveProblems && (
                      <div style={{marginLeft: '12px'}}>
                        <input
                          type="checkbox"
                          checked={selectedAvailable.includes(problem.id)}
                          onChange={() => handleSelectAvailable(problem.id)}
                          onClick={e => e.stopPropagation()}
                          style={{width: '16px', height: '16px', cursor: 'pointer'}}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Migration Controls */}
          <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '20px', padding: '20px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)'}}>
            <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
              <button
                onClick={handleMoveToContest}
                disabled={!canMoveProblems || selectedAvailable.length === 0 || migrationLoading}
                style={{
                  padding: '16px 20px',
                  fontSize: '1.5rem',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  minWidth: '120px',
                  backgroundColor: 'var(--primary-color)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer'
                }}
                title="Move selected problems to contest"
              >
                {migrationLoading ? '🔄' : '➡️'}
                <br />
                <small style={{fontSize: '0.75rem', fontWeight: '500'}}>Add to Contest</small>
              </button>
              
              <button
                onClick={() => handleMoveToMain()}
                disabled={!canMoveProblems || selectedContest.length === 0 || migrationLoading}
                style={{
                  padding: '16px 20px',
                  fontSize: '1.5rem',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  minWidth: '120px',
                  backgroundColor: '#ffc107',
                  color: '#212529',
                  border: 'none',
                  cursor: 'pointer'
                }}
                title="Move selected problems back to main pool"
              >
                {migrationLoading ? '🔄' : '⬅️'}
                <br />
                <small style={{fontSize: '0.75rem', fontWeight: '500'}}>Remove from Contest</small>
              </button>
            </div>
            
            <div style={{textAlign: 'center'}}>
              <div style={{color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '4px'}}>
                📋 {selectedAvailable.length} selected from available
              </div>
              <div style={{color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '4px'}}>
                📋 {selectedContest.length} selected from contest
              </div>
            </div>
          </div>

          {/* Contest Problems */}
          <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', paddingBottom: '10px', borderBottom: '2px solid var(--border-color)'}}>
              <div>
                <h3>Contest Problems ({contestProblems.length})</h3>
                <p style={{margin: '0', color: 'var(--text-secondary)', fontSize: '0.85rem'}}>Problems currently assigned to this contest</p>
              </div>
              {canMoveProblems && contestProblems.length > 0 && (
                <button
                  onClick={handleSelectAllContest}
                  style={{padding: '6px 12px', fontSize: '0.8rem', backgroundColor: 'var(--background-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px'}}
                >
                  {selectedContest.length === contestProblems.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div style={{flex: 1, maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)'}}>
              {contestProblems.length === 0 ? (
                <div style={{textAlign: 'center', padding: '40px 20px'}}>
                  <div style={{fontSize: '2.5rem', marginBottom: '15px'}}>🏆</div>
                  <h3>No Contest Problems</h3>
                  <p>No problems have been assigned to this contest yet</p>
                </div>
              ) : (
                contestProblems.map((problem) => (
                  <div
                    key={problem.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background-color 0.2s ease',
                      position: 'relative',
                      background: selectedContest.includes(problem.id) ? '#e3f2fd' : 'transparent',
                      borderColor: selectedContest.includes(problem.id) ? '#1976d2' : 'var(--border-color)',
                      cursor: canMoveProblems ? 'pointer' : 'not-allowed',
                      opacity: canMoveProblems ? 1 : 0.6
                    }}
                    onClick={() => canMoveProblems && handleSelectContest(problem.id)}
                  >
                    <div style={{flex: 1, minWidth: 0}}>
                      <h4 style={{margin: '0 0 4px 0', color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        {problem.title}
                      </h4>
                      <p style={{margin: '0', color: 'var(--text-secondary)', fontSize: '0.8rem'}}>by {problem.author}</p>
                    </div>
                    {canMoveProblems && (
                      <div style={{marginLeft: '12px'}}>
                        <input
                          type="checkbox"
                          checked={selectedContest.includes(problem.id)}
                          onChange={() => handleSelectContest(problem.id)}
                          onClick={e => e.stopPropagation()}
                          style={{width: '16px', height: '16px', cursor: 'pointer'}}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '20px'}}>
          <div>
            <p style={{margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem'}}>
              <strong>💡 Tip:</strong> Problems can only be moved for scheduled contests. 
              Once a contest starts, the problem list is locked.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{backgroundColor: 'var(--background-tertiary)', color: 'var(--text-primary)', width: 'auto', padding: '10px 20px', border: '1px solid var(--border-color)', borderRadius: '6px'}}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProblemMigrationModal; 