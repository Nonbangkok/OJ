import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { useParams } from 'react-router-dom';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import { getErrorStatus, toApiLikeError } from '../utils/error';
import type { Contest, ProblemDetail, ProblemSummary, SliderStyle } from '../types';

interface HiddenProblemInfo {
  problemId: string;
  title: string;
  detail: string;
}

export const useProblemDetail = () => {
  const { contestId, problemId } = useParams();
  const [problem, setProblem] = useState<(ProblemDetail & Partial<ProblemSummary>) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hiddenProblemInfo, setHiddenProblemInfo] = useState<HiddenProblemInfo | null>(null);
  const [activeView, setActiveView] = useState('statement');
  const [contest, setContest] = useState<Contest | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const [sliderStyle, setSliderStyle] = useState<SliderStyle>({ opacity: 0 });

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        let problemData;
        if (contestId && problemId) {
          problemData = await problemService.getContestProblemDetails(contestId, problemId);
          const contestRes = await contestService.getById(contestId);
          setContest(contestRes);
        } else if (problemId) {
          const details = await problemService.getDetails(problemId);
          const allStats = await problemService.getAllWithStats();
          const currentStats = allStats.find((p) => String(p.id) === problemId);
          problemData = { ...details, ...currentStats };
        }
        if (problemData) {
          setProblem(problemData);
        }
      } catch (err) {
        const apiError = toApiLikeError(err);
        if (getErrorStatus(err) === 403 && apiError.response?.data?.message === 'Problem is hidden') {
          setHiddenProblemInfo({
            problemId: String(apiError.response?.data?.problemId ?? ''),
            title: String(apiError.response?.data?.title ?? ''),
            detail: String(apiError.response?.data?.detail ?? ''),
          });
        } else if (getErrorStatus(err) === 404) {
          setError(`Problem ${problemId} not found.`);
        } else {
          const responseMessage = apiError.response?.data?.message;
          setError(
            typeof responseMessage === 'string' && responseMessage
              ? responseMessage
              : `Failed to fetch problem ${problemId}.`,
          );
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

  const handleMouseEnter = (e: MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    setSliderStyle({
      height: btn.offsetHeight + 5,
      top: btn.offsetTop + 22,
      opacity: 1,
    });
  };

  const resetSlider = (styles?: { active: string }) => {
    try {
      const activeClass = styles?.active ?? 'active';
      const activeBtn = navRef.current?.querySelector<HTMLElement>(`.${activeClass}`);
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
    resetSlider,
  };
};
