import useProblemModal from '../../../hooks/admin/useProblemModal';
import formStyles from '../../../components/styles/Form.module.css';
import modalStyles from '../shared/ModalLayout.module.css';
import type { Problem, User } from '../../../types';

interface ProblemModalProps {
  problem: Problem | null;
  onClose: () => void;
  onSave: ({ problemData, pdfFile, zipFile }: { problemData: any; pdfFile?: File; zipFile?: File }) => Promise<void>;
  uploadProgress: any;
  currentUser: User | null;
}

const ProblemModal = ({ problem, onClose, onSave, uploadProgress, currentUser }: ProblemModalProps) => {
  const {
    formData,
    authors,
    setPdfFile,
    setZipFile,
    pdfRef,
    zipRef,
    isEditing,
    isUploading,
    handleChange,
    handleSave
  } = useProblemModal(problem, onSave, uploadProgress, currentUser);

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
            <label htmlFor="timeLimit">Time Limit (ms)</label>
            <input
              type="number"
              id="timeLimit"
              name="timeLimit"
              value={formData.timeLimit}
              onChange={handleChange}
            />
          </div>

          <div className={formStyles['form-group']}>
            <label htmlFor="memoryLimit">Memory Limit (MB)</label>
            <input
              type="number"
              id="memoryLimit"
              name="memoryLimit"
              value={formData.memoryLimit}
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
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className={formStyles['form-group']} style={{ marginBottom: '0.25rem' }}>
            <label htmlFor="zipFile">Test Cases ZIP</label>
            <input
              type="file"
              id="zipFile"
              ref={zipRef}
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] || null)}
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