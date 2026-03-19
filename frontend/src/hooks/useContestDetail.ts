import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import contestService from '../services/contestService';

/**
 * Custom hook to handle logic for ContestDetail page.
 * Separates data fetching, polling, joining, and navigation logic.
 */
const useContestDetail = () => {
    const { contestId } = useParams();
    const navigate = useNavigate();

    const [contest, setContest] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [joining, setJoining] = useState(false);

    const fetchContestData = useCallback(async (isInitial = false) => {
        try {
            if (isInitial) setLoading(true);

            const fetchedContest = await contestService.getById(contestId!);
            setContest(fetchedContest);

            // Redirect logic if contest is finished
            if (fetchedContest.status === 'finished') {
                const redirectPath = fetchedContest.is_participant
                    ? `/contests/${contestId}/scoreboard`
                    : '/contests';
                navigate(redirectPath);
            }
        } catch (err) {
            console.error('Error fetching contest data:', err);
            if ((err as any).response?.status === 403) {
                setError('You need to join this contest to view its details.');
                // If user is not participant and contest is finished, redirect to /contests
                if (contest?.status === 'finished') {
                    navigate('/contests');
                }
            } else if ((err as any).response?.status === 404) {
                setError('Contest not found.');
            } else {
                setError('Failed to load contest data.');
            }
        } finally {
            if (isInitial) setLoading(false);
        }
    }, [contestId, navigate, contest?.status]);

    useEffect(() => {
        fetchContestData(true);

        const intervalId = setInterval(() => {
            fetchContestData();
        }, 15000); // Poll every 15 seconds

        return () => clearInterval(intervalId);
    }, [fetchContestData]);

    const handleJoinContest = async () => {
        setJoining(true);
        try {
            await contestService.join(contestId!);
            await fetchContestData();
        } catch (err) {
            console.error('Error joining contest:', err);
            alert((err as any).response?.data?.message || 'Failed to join contest');
        } finally {
            setJoining(false);
        }
    };

    return {
        contest,
        loading,
        error,
        joining,
        handleJoinContest,
        fetchContestData
    };
};

export default useContestDetail;
