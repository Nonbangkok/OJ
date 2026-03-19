import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import adminService from '../../services/adminService';
import { Contest } from '../../types';

const useContestModal = (contest: Contest | null | undefined, _onClose: () => void, onSuccess: () => void) => {
    const [formData, setFormData] = useState<{
        title: string;
        description: string;
        startTime: Date | null;
        endTime: Date | null;
    }>({
        title: '',
        description: '',
        startTime: null,
        endTime: null
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (contest) {
            setFormData({
                title: contest.title || '',
                description: contest.description || '',
                startTime: contest.startTime ? new Date(contest.startTime) : new Date(),
                endTime: contest.endTime ? new Date(contest.endTime) : new Date()
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
                startTime: tomorrow,
                endTime: dayAfter
            });
        }
    }, [contest]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        // Validation
        if (!formData.title.trim()) {
            setError('Contest title is required');
            return;
        }

        if (!formData.startTime || !formData.endTime) {
            setError('Start time and end time are required');
            return;
        }

        const startTime = formData.startTime;
        const endTime = formData.endTime;

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
                await adminService.updateContest(contest.id, contestData);
            } else {
                // Create new contest
                await adminService.createContest(contestData);
            }

            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error('Error saving contest:', err);
            setError(err.response?.data?.message || 'Failed to save contest');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleDateChange = (date: Date | null, name: string) => {
        setFormData(prev => ({
            ...prev,
            [name]: date
        }));
    };

    const getDurationText = () => {
        if (formData.startTime && formData.endTime) {
            const startTime = formData.startTime;
            const endTime = formData.endTime;
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

    return {
        formData,
        loading,
        error,
        handleSubmit,
        handleChange,
        handleDateChange,
        getDurationText
    };
};

export default useContestModal;
