import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import problemService from '../services/problemService';
import contestService from '../services/contestService';

export const useProblemDetail = () => {
    const { contestId, problemId } = useParams();
    const [problem, setProblem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [hiddenProblemInfo, setHiddenProblemInfo] = useState(null);
    const [activeView, setActiveView] = useState('statement');
    const [contest, setContest] = useState(null);
    const navRef = useRef(null);
    const [sliderStyle, setSliderStyle] = useState({ opacity: 0 });

    useEffect(() => {
        const fetchProblem = async () => {
            try {
                let problemData;
                if (contestId) {
                    problemData = await problemService.getContestProblemDetails(contestId, problemId);
                    const contestRes = await contestService.getById(contestId);
                    setContest(contestRes);
                } else {
                    const details = await problemService.getDetails(problemId);
                    const allStats = await problemService.getAllWithStats();
                    const currentStats = allStats.find(p => String(p.id) === problemId);
                    problemData = { ...details, ...currentStats };
                }
                setProblem(problemData);
            } catch (err) {
                if (err.response?.status === 403 && err.response?.data?.message === 'Problem is hidden') {
                    setHiddenProblemInfo({
                        problemId: err.response.data.problemId,
                        title: err.response.data.title,
                        detail: err.response.data.detail
                    });
                } else if (err.response?.status === 404) {
                    setError(`Problem ${problemId} not found.`);
                } else {
                    setError(err.response?.data?.message || `Failed to fetch problem ${problemId}.`);
                }
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        if (problemId) {
            fetchProblem();
        }
    }, [problemId, contestId]);

    const handleMouseEnter = (e) => {
        const btn = e.currentTarget;
        setSliderStyle({
            height: btn.offsetHeight + 5,
            top: btn.offsetTop + 22,
            opacity: 1,
        });
    };

    const resetSlider = (styles) => {
        try {
            const activeBtn = navRef.current?.querySelector(`.${styles.active}`);
            if (activeBtn) {
                setSliderStyle({
                    height: activeBtn.offsetHeight + 5,
                    top: activeBtn.offsetTop + 22,
                    opacity: 1,
                });
            } else {
                setSliderStyle((prev) => ({ ...prev, opacity: 0 }));
            }
        } catch (e) {
            setSliderStyle({ opacity: 0 });
        }
    };

    return {
        problemId,
        contestId,
        problem,
        loading,
        error,
        hiddenProblemInfo,
        activeView,
        setActiveView,
        navRef,
        sliderStyle,
        handleMouseEnter,
        resetSlider
    };
};