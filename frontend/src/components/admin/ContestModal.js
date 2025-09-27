import React, { useState, useEffect } from 'react';
import axios from 'axios';
import formStyles from '../Form.module.css';
import modalStyles from './ModalLayout.module.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const API_URL = process.env.REACT_APP_API_URL;

function ContestModal({ contest, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    start_time: null,
    end_time: null
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (contest) {
      setFormData({
        title: contest.title || '',
        description: contest.description || '',
        start_time: new Date(contest.start_time),
        end_time: new Date(contest.end_time)
      });
    } else {
      // Default to tomorrow for new contests
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0); // 10:00 AM
      
      const dayAfter = new Date(tomorrow);
      dayAfter.setHours(16, 0, 0, 0); // 4:00 PM same day
      
      setFormData({
        title: '',
        description: '',
        start_time: tomorrow,
        end_time: dayAfter
      });
    }
  }, [contest]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!formData.title.trim()) {
      setError('Contest title is required');
      return;
    }
    
    if (!formData.start_time || !formData.end_time) {
      setError('Start time and end time are required');
      return;
    }
    
    const startTime = formData.start_time;
    const endTime = formData.end_time;
    
    if (startTime >= endTime) {
      setError('End time must be after start time');
      return;
    }
    
    // Check if start time is in the past for new contests
    if (!contest && startTime <= new Date()) {
      setError('Start time must be in the future');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      
      // Convert Date objects to ISO strings for backend
      const contestData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      };

      if (contest) {
        // Update existing contest
        await axios.put(`${API_URL}/admin/contests/${contest.id}`, contestData, {
          withCredentials: true
        });
      } else {
        // Create new contest
        await axios.post(`${API_URL}/admin/contests`, contestData, {
          withCredentials: true
        });
      }
      
      onSuccess();
    } catch (err) {
      console.error('Error saving contest:', err);
      setError(err.response?.data?.message || 'Failed to save contest');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleDateChange = (date, name) => {
    setFormData(prev => ({
      ...prev,
      [name]: date
    }));
  };

  const getDurationText = () => {
    if (formData.start_time && formData.end_time) {
      const startTime = formData.start_time;
      const endTime = formData.end_time;
      const durationMs = endTime.getTime() - startTime.getTime();
      
      if (durationMs > 0) {
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
          return `Duration: ${hours} hour${hours > 1 ? 's' : ''} ${minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''}` : ''}`;
        } else if (minutes > 0) {
          return `Duration: ${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
      }
    }
    return '';
  };

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
              minDate={formData.start_time || new Date()}
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