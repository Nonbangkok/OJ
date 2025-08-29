import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ProblemModal from './ProblemModal';
import ConfirmationModal from './ConfirmationModal';
import styles from './Management.module.css';

const API_URL = process.env.REACT_APP_API_URL;

const ProblemManagement = ({ currentUser }) => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // State for upload progress

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [problemToDelete, setProblemToDelete] = useState(null);

  const fetchProblems = async () => {
    try {
      // setLoading(true);
      const response = await axios.get(`${API_URL}/api/admin/problems`, { withCredentials: true });
      setProblems(response.data);
    } catch (err) {
      setError('Failed to fetch problems.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProblems();
  }, []);

  const handleDeleteClick = (problemId) => {
    setProblemToDelete(problemId);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (problemToDelete) {
      try {
        await axios.delete(`${API_URL}/api/admin/problems/${problemToDelete}`, { withCredentials: true });
        fetchProblems();
      } catch (err) {
        setError('Failed to delete problem.');
        console.error(err);
      } finally {
        setIsConfirmModalOpen(false);
        setProblemToDelete(null);
      }
    }
  };

  const handleToggleVisibility = async (problemId, currentVisibility) => {
    try {
      await axios.put(
        `${API_URL}/api/admin/problems/${problemId}/visibility`,
        { isVisible: !currentVisibility },
        { withCredentials: true }
      );
      fetchProblems();
    } catch (err) {
      setError('Failed to update problem visibility.');
      console.error(err);
    }
  };

  const handleHideAll = async () => {
    try {
      setLoading(true);
      const hidePromises = problems
        .filter(problem => problem.is_visible)
        .map(problem => 
          axios.put(
            `${API_URL}/api/admin/problems/${problem.id}/visibility`,
            { isVisible: false },
            { withCredentials: true }
          )
        );
      
      await Promise.all(hidePromises);
      fetchProblems();
    } catch (err) {
      setError('Failed to hide all problems.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleShowAll = async () => {
    try {
      setLoading(true);
      const showPromises = problems
        .filter(problem => !problem.is_visible)
        .map(problem => 
          axios.put(
            `${API_URL}/api/admin/problems/${problem.id}/visibility`,
            { isVisible: true },
            { withCredentials: true }
          )
        );
      
      await Promise.all(showPromises);
      fetchProblems();
    } catch (err) {
      setError('Failed to show all problems.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (problem) => {
    try {
      const response = await axios.get(`${API_URL}/api/problems/${problem.id}`);
      setEditingProblem(response.data);
      setIsModalOpen(true);
    } catch (err) {
      setError('Failed to fetch problem details.');
      console.error(err);
    }
  };

  const handleCreate = () => {
    setEditingProblem(null);
    setIsModalOpen(true);
  };

  const handleSave = async ({ problemData, pdfFile, zipFile }) => {
    const isEditing = !!editingProblem;
    // Reset progress on new save
    setUploadProgress({ status: 'pending', message: 'Initiating save...' });

    try {
      let problemIdForUpload = problemData.id;

      if (isEditing) {
        await axios.put(`${API_URL}/api/admin/problems/${editingProblem.id}`, problemData, { withCredentials: true });
      } else {
        const response = await axios.post(`${API_URL}/api/admin/problems`, problemData, { withCredentials: true });
        problemIdForUpload = response.data.id;
      }

      if (pdfFile || zipFile) {
        const fileData = new FormData();
        if (pdfFile) fileData.append('problemPdf', pdfFile);
        if (zipFile) fileData.append('testcasesZip', zipFile);

        setUploadProgress({ status: 'uploading', message: 'Uploading files to server...' });

        const response = await axios.post(`${API_URL}/api/admin/problems/${problemIdForUpload}/upload`, fileData, {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        // Start polling for progress
        const { jobId } = response.data;
        if (jobId) {
          const pollInterval = setInterval(async () => {
            try {
              const progressRes = await axios.get(`${API_URL}/api/admin/upload-progress/${jobId}`, { withCredentials: true });
              const progressData = progressRes.data;
              setUploadProgress(progressData);

              if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(pollInterval);
                // Close modal immediately on success
                if (progressData.status === 'completed') {
                  setIsModalOpen(false);
                  fetchProblems();
                  setUploadProgress(null); // Reset progress
                }
              }
            } catch (pollError) {
              console.error('Polling error:', pollError);
              setError('Failed to get upload progress.');
              setUploadProgress({ status: 'failed', message: 'Could not retrieve processing status.' });
              clearInterval(pollInterval);
            }
          }, 1500);
        } else {
           // If no job ID, it means no zip file, so we are done
           setIsModalOpen(false);
           fetchProblems();
           setUploadProgress(null);
        }
      } else {
        // No files to upload, just close modal and refresh
        setIsModalOpen(false);
        fetchProblems();
        setUploadProgress(null);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to save problem.';
      setError(errorMsg);
      setUploadProgress({ status: 'failed', message: errorMsg });
      console.error(err);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setUploadProgress(null);
  };

  if (loading) return <div>Loading problems...</div>;
  if (error) return <div className='error-message'>{error}</div>;

  return (
    <div className={styles['management-container']}>
      <div className={styles['management-header']}>
        <h2>Problem Management</h2>
        <div className={styles['header-actions']}>
          <div className={styles['bulk-actions']}>
            <button 
              onClick={handleShowAll} 
              className={styles['show-all-btn']}
              disabled={loading || problems.every(p => p.is_visible)}
              title="Show all hidden problems"
            >
              Show All
            </button>
            <button 
              onClick={handleHideAll} 
              className={styles['hide-all-btn']}
              disabled={loading || problems.every(p => !p.is_visible)}
              title="Hide all visible problems"
            >
              Hide All
            </button>
          </div>
          <button onClick={handleCreate} className={styles['create-btn']}>Create New Problem</button>
        </div>
      </div>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Visibility</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {problems.map(problem => (
              <tr key={problem.id}>
                <td>{problem.id}</td>
                <td>{problem.title}</td>
                <td>
                  <button
                    onClick={() => handleToggleVisibility(problem.id, problem.is_visible)}
                    className={problem.is_visible ? styles['visible-btn'] : styles['hidden-btn']}
                    title={problem.is_visible ? 'Click to hide' : 'Click to show'}
                  >
                    {problem.is_visible ? 'Visible' : 'Hidden'}
                  </button>
                </td>
                <td className={styles.actions}>
                  <button onClick={() => handleEdit(problem)} className={styles['edit-btn']}>Edit</button>
                  <button onClick={() => handleDeleteClick(problem.id)} className={styles['delete-btn']}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isModalOpen && (
        <ProblemModal
          problem={editingProblem}
          onClose={handleCloseModal}
          onSave={handleSave}
          uploadProgress={uploadProgress} // Pass progress to modal
          currentUser={currentUser}
        />
      )}
      <ConfirmationModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Confirm Deletion"
        message={`Are you sure you want to delete problem "${problemToDelete}"? All related test cases and submissions will also be deleted.`}
      />
    </div>
  );
};

export default ProblemManagement; 