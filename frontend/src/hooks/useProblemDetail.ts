import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import type { Problem, ProblemWithStats, Contest } from '../types';

interface HiddenProblemInfo {
    problemId: string | number;
    title: string;
    detail: string;
}

interface UseProblemDetailReturn {
    problemId: string | undefined;
    contestId: string | undefined;
    problem: (Problem | ProblemWithStats) | null;
    contest: Contest | null;
    loading: boolean;
    error: string;
    hiddenProblemInfo: HiddenProblemInfo | null;
    activeView: string;
    setActiveView: (view: string) => void;
    navRef: React.RefObject<HTMLDivElement | null>;
    sliderStyle: React.CSSProperties;
    handleMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
    resetSlider: (styles: { [key: string]: string }) => void;
}

export const useProblemDetail = (): UseProblemDetailReturn => {
    const { contestId, problemId } = useParams<{ contestId?: string; problemId: string }>();
    const [problem, setProblem] = useState<(Problem | ProblemWithStats) | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [hiddenProblemInfo, setHiddenProblemInfo] = useState<HiddenProblemInfo | null>(null);
    const [activeView, setActiveView] = useState<string>('statement');
    const [contest, setContest] = useState<Contest | null>(null);
    const navRef = useRef<HTMLDivElement>(null);
    const [sliderStyle, setSliderStyle] = useState<React.CSSProperties>({ opacity: 0 });

    useEffect(() => {
        const fetchProblem = async (): Promise<void> => {
            if (!problemId) return;
            try {
                let problemData: Problem | ProblemWithStats;
                if (contestId) {
                    problemData = await problemService.getContestProblemDetails(contestId, problemId);
                    const contestRes = await contestService.getById(contestId);
                    setContest(contestRes);
                } else {
                    const details = await problemService.getDetails(problemId);
                    const allStats = await problemService.getAllWithStats();
                    const currentStats = allStats.find(p => String(p.id) === problemId);
                    problemData = { ...details, ...currentStats } as ProblemWithStats;
                }
                setProblem(problemData);
            } catch (err: any) {
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

    const handleMouseEnter = (e: React.MouseEvent<HTMLElement>): void => {
        const btn = e.currentTarget;
        setSliderStyle({
            height: btn.offsetHeight + 5,
            top: btn.offsetTop + 22,
            opacity: 1,
        });
    };

    const resetSlider = (styles: { [key: string]: string }): void => {
        try {
            const activeBtn = navRef.current?.querySelector(`.${styles.active}`) as HTMLElement;
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
        contest,
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