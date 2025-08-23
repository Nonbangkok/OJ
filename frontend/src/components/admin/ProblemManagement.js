import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../Table.css'; // Use the new shared table styles
import ProblemModal from './ProblemModal';

const ProblemManagement = ({ currentUser }) => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // State for upload progress

  const fetchProblems = async () => {
    try {
      setLoading(true);
      const response = await axios.get('http://localhost:3000/api/problems');
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

  const handleDelete = async (problemId) => {
    if (window.confirm('Are you sure you want to delete this problem? All related test cases and submissions will also be deleted.')) {
      try {
        await axios.delete(`http://localhost:3000/api/admin/problems/${problemId}`, { withCredentials: true });
        fetchProblems();
      } catch (err) {
        setError('Failed to delete problem.');
        console.error(err);
      }
    }
  };

  const handleEdit = async (problem) => {
    try {
      const response = await axios.get(`http://localhost:3000/api/problems/${problem.id}`);
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
        await axios.put(`http://localhost:3000/api/admin/problems/${editingProblem.id}`, problemData, { withCredentials: true });
      } else {
        const response = await axios.post('http://localhost:3000/api/admin/problems', problemData, { withCredentials: true });
        problemIdForUpload = response.data.id;
      }

      if (pdfFile || zipFile) {
        const fileData = new FormData();
        if (pdfFile) fileData.append('problemPdf', pdfFile);
        if (zipFile) fileData.append('testcasesZip', zipFile);

        setUploadProgress({ status: 'uploading', message: 'Uploading files to server...' });
        
        const response = await axios.post(`http://localhost:3000/api/admin/problems/${problemIdForUpload}/upload`, fileData, {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        // Start polling for progress
        const { jobId } = response.data;
        if (jobId) {
          const pollInterval = setInterval(async () => {
            try {
              const progressRes = await axios.get(`http://localhost:3000/api/admin/upload-progress/${jobId}`, { withCredentials: true });
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


  if (loading) return <div>Loading problems...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="management-container">
      <div className="management-header">
        <h2>Problem Management</h2>
        <button onClick={handleCreate} className="create-btn">Create New Problem</button>
      </div>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {problems.map(problem => (
              <tr key={problem.id}>
                <td>{problem.id}</td>
                <td>{problem.title}</td>
                <td className="actions">
                  <button onClick={() => handleEdit(problem)} className="edit-btn">Edit</button>
                  <button onClick={() => handleDelete(problem.id)} className="delete-btn">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isModalOpen && (
        <ProblemModal
          problem={editingProblem}
          onClose={() => {
            setIsModalOpen(false);
            setUploadProgress(null);
          }}
          onSave={handleSave}
          uploadProgress={uploadProgress} // Pass progress to modal
          currentUser={currentUser}
        />
      )}
    </div>
  );
};

export default ProblemManagement; 