import useProblemModal from '../../../hooks/admin/useProblemModal';
import { Button } from '../../../components/ui';
import { PROBLEM_CATEGORIES, PROBLEM_DIFFICULTY_OPTIONS, difficultyBand } from '../../../utils/constants';
import formStyles from '../../../components/styles/Form.module.css';
import modalStyles from '../shared/ModalLayout.module.css';

const ProblemModal = ({ problem, onClose, onSave, uploadProgress, currentUser }) => {
  const {
    formData,
    authors,
    pdfFile,
    setPdfFile,
    zipFile,
    setZipFile,
    pdfRef,
    zipRef,
    isEditing,
    isUploading,
    handleChange,
    handleCategoryToggle,
    handleSave
  } = useProblemModal(problem, onSave, uploadProgress, currentUser);

  return (
    <div className={modalStyles['modal-backdrop']}>
      <div className={`${formStyles['form-container']} ${formStyles['problem-form']}`}>
        <header className={formStyles['problem-form-header']}>
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
        </header>

        <div className={formStyles['problem-form-content']}>
          <fieldset disabled={isUploading} className={formStyles['problem-form-fields']}>
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

            <div className={formStyles['form-group']}>
              <label htmlFor="zipFile">Test Cases ZIP</label>
              <input
                type="file"
                id="zipFile"
                ref={zipRef}
                accept=".zip"
                onChange={(e) => setZipFile(e.target.files[0])}
              />
            </div>

            <div className={`${formStyles['form-group']} ${formStyles['category-group']}`}>
              <span className={formStyles['group-label']}>Categories</span>
              <div className={formStyles['category-options']}>
                {PROBLEM_CATEGORIES.map(category => (
                  <label key={category} className={formStyles['category-option']}>
                    <input
                      type="checkbox"
                      checked={formData.categories.includes(category)}
                      onChange={e => handleCategoryToggle(category, e.target.checked)}
                    />
                    {category}
                  </label>
                ))}
              </div>
            </div>

            <div className={formStyles['form-group']}>
              <label htmlFor="difficulty">Difficulty</label>
              <div className={formStyles['difficulty-field']}>
                <select
                  id="difficulty"
                  name="difficulty"
                  value={formData.difficulty ?? ''}
                  onChange={handleChange}
                >
                  <option value="">Unrated</option>
                  {PROBLEM_DIFFICULTY_OPTIONS.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                {formData.difficulty !== null && difficultyBand(formData.difficulty) !== null && (
                  <span
                    className={formStyles[`difficulty-preview-${difficultyBand(formData.difficulty)}`]}
                    aria-hidden="true"
                  >
                    {formData.difficulty}
                  </span>
                )}
              </div>
            </div>
          </fieldset>
        </div>

        <div className={`${modalStyles['modal-actions']} ${formStyles['problem-form-actions']}`}>
          <Button variant="secondary" onClick={onClose} disabled={isUploading}>Cancel</Button>
          <Button onClick={handleSave} disabled={isUploading}>
            {isUploading ? 'Processing…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProblemModal;
