import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import formStyles from '../Form.module.css';
import modalStyles from './ModalLayout.module.css';

const API_URL = process.env.REACT_APP_API_URL;

const ProblemModal = ({ problem, onClose, onSave, uploadProgress, currentUser }) => {
  const [formData, setFormData] = useState({
    id: '',
    title: '',
    author: '',
    time_limit_ms: 2000,
    memory_limit_mb: 512,
  });
  const [authors, setAuthors] = useState([]);
  const [pdfFile, setPdfFile] = useState(null);
  const [zipFile, setZipFile] = useState(null);
  const pdfRef = useRef();
  const zipRef = useRef();

  const isEditing = !!problem;
  const isUploading = uploadProgress && !['completed', 'failed'].includes(uploadProgress.status);

  useEffect(() => {
    const fetchAuthors = async () => {
      try {
        const response = await axios.get(`${API_URL}/admin/authors`, { withCredentials: true });
        setAuthors(response.data);
      } catch (err) {
        console.error("Failed to fetch authors", err);
      }
    };
    fetchAuthors();
  }, []);

  useEffect(() => {
    if (problem) {
      setFormData({
        id: problem.id,
        title: problem.title ?? '',
        author: problem.author ?? '',
        time_limit_ms: problem.time_limit_ms ?? 3000,
        memory_limit_mb: problem.memory_limit_mb ?? 256,
      });
    } else {
      // Reset form for creating new problem
      setFormData({
        id: '',
        title: '',
        author: currentUser?.username ?? '',
        time_limit_ms: 1000,
        memory_limit_mb: 256,
      });
    }
    // Clear file inputs on open
    if(pdfRef.current) pdfRef.current.value = null;
    if(zipRef.current) zipRef.current.value = null;
    setPdfFile(null);
    setZipFile(null);
  }, [problem, currentUser]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      // Treat all form values as strings. The backend will handle parsing.
      [name]: value,
    }));
  };

  const handleSave = () => {
    // Pass the collected data back to the parent component
    onSave({
      problemData: formData,
      pdfFile,
      zipFile,
    }, isEditing);
  };

  return (
    <div className={modalStyles['modal-backdrop']}>
      <div className={formStyles['form-container']}>
        <h2>{isEditing ? 'Edit Problem' : 'Create New Problem'}</h2>
        
        {/* Progress Bar Area */}
        {uploadProgress && (
          <div className={modalStyles['upload-progress-container']}>
            <p>{uploadProgress.message}</p>
            {(uploadProgress.status === 'processing' || uploadProgress.status === 'uploading') && uploadProgress.total > 0 && (
              <progress 
                value={uploadProgress.progress} 
                max={uploadProgress.total} 
                style={{ width: '100%', height: '20px' }}
              />
            )}
            {uploadProgress.status === 'completed' && <p>✅ Upload finished!</p>}
            {uploadProgress.status === 'failed' && <p>❌ Upload failed.</p>}
          </div>
        )}

        <fieldset disabled={isUploading}>
          <div className={formStyles['form-group']}>
            <label htmlFor="id">Problem ID</label>
            <input
              type="text"
              id="id"
              name="id"
              value={formData.id}
              onChange={handleChange}
            />
          </div>

          <div className={formStyles['form-group']}>
            <label htmlFor="title">Title</label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
            />
          </div>

          <div className={formStyles['form-group']}>
            <label htmlFor="author">Author</label>
            <select
              id="author"
              name="author"
              value={formData.author}
              onChange={handleChange}
            >
              <option value="">Select an author</option>
              {authors.map(author => (
                <option key={author.id} value={author.username}>
                  {author.username}
                </option>
              ))}
            </select>
          </div>

          <div className={formStyles['form-group']}>
            <label htmlFor="time_limit_ms">Time Limit (ms)</label>
            <input
              type="number"
              id="time_limit_ms"
              name="time_limit_ms"
              value={formData.time_limit_ms}
              onChange={handleChange}
            />
          </div>

          <div className={formStyles['form-group']}>
            <label htmlFor="memory_limit_mb">Memory Limit (MB)</label>
            <input
              type="number"
              id="memory_limit_mb"
              name="memory_limit_mb"
              value={formData.memory_limit_mb}
              onChange={handleChange}
            />
          </div>

          <div className={formStyles['form-group']}>
            <label htmlFor="pdfFile">Problem PDF</label>
            <input
              type="file"
              id="pdfFile"
              ref={pdfRef}
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files[0])}
            />
          </div>

          <div className={formStyles['form-group']} style={{marginBottom: '0.25rem'}}>
            <label htmlFor="zipFile">Test Cases ZIP</label>
            <input
              type="file"
              id="zipFile"
              ref={zipRef}
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files[0])}
            />
          </div>
        </fieldset>

        <div className={modalStyles['modal-actions']}>
          <button onClick={onClose} className={modalStyles['button-cancel']} disabled={isUploading}>Cancel</button>
          <button onClick={handleSave} className={modalStyles['button-save']} disabled={isUploading}>
            {isUploading ? 'Processing...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProblemModal; 