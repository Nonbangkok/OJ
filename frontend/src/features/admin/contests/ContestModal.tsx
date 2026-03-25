import useContestModal from '../../../hooks/admin/useContestModal';
import formStyles from '../../../components/styles/Form.module.css';
import modalStyles from '../shared/ModalLayout.module.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const ContestModal = ({ contest, onClose, onSuccess }) => {
  const {
    formData,
    loading,
    error,
    handleSubmit,
    handleChange,
    handleDateChange,
    getDurationText
  } = useContestModal(contest, onClose, onSuccess);


  return (
    <div className={modalStyles['modal-overlay']}>
      <div className={formStyles['form-container']}>
        <h2>{contest ? 'Edit Contest' : 'Create New Contest'}</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className={formStyles['error-message']}>
              ⚠️ {error}
            </div>
          )}

          {/* Contest Title */}
          <div className={formStyles['form-group']}>
            <label htmlFor="title">
              Contest Title *
            </label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="Enter contest title..."
              maxLength={255}
              required
            />
          </div>

          {/* Contest Description */}
          <div className={formStyles['form-group']}>
            <label htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Enter contest description..."
              rows={4}
              maxLength={1000}
            />
            <small className={modalStyles['contest-char-count']}>
              {formData.description.length}/1000 characters
            </small>
          </div>

          {/* Start Time */}
          <div className={formStyles['form-group']}>
            <label htmlFor="start_time">
              Start Time :
            </label>
            <div className={formStyles['form-time']}>
              <DatePicker
                selected={formData.start_time}
                onChange={(date) => handleDateChange(date, 'start_time')}
                showTimeSelect
                dateFormat="MMM dd, yyyy, h:mm aa"
                timeFormat="HH:mm"
                timeIntervals={30}
                minDate={new Date()}
                required
              />
            </div>
          </div>

          {/* End Time */}
          <div className={formStyles['form-group']}>
            <label htmlFor="end_time">
              End Time :
            </label>
            <div className={formStyles['form-time']}>
              <DatePicker
                selected={formData.end_time}
                onChange={(date) => handleDateChange(date, 'end_time')}
                showTimeSelect
                dateFormat="MMM dd, yyyy, h:mm aa"
                timeFormat="HH:mm"
                timeIntervals={30}
                minDate={formData.start_time ?? new Date()}
                required
              />
            </div>
          </div>

          {/* Duration Display */}
          {getDurationText() && (
            <div className={modalStyles['contest-duration-display']}>
              ⏱️ {getDurationText()}
            </div>
          )}

          <div className={modalStyles['contest-form-actions']}>
            <button
              type="button"
              onClick={onClose}
              className={modalStyles['contest-form-cancel']}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={modalStyles['contest-form-submit']}
            >
              {loading ? 'Saving...' : (contest ? 'Update Contest' : 'Create Contest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ContestModal; 
