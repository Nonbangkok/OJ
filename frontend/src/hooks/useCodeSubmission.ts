import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import 'highlight.js/styles/atom-one-dark.css';
import submissionService from '../services/submissionService';

// Register C++ language
hljs.registerLanguage('cpp', cpp);

const useCodeSubmission = (problemId, contestId) => {
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(``);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const editorWrapperRef = useRef(null);
  const lineNumbersRef = useRef(null);

  useEffect(() => {
    try {
      const cachedSubmission = JSON.parse(localStorage.getItem('oj-submission-cache') || '{}');
      const problemCache = cachedSubmission[problemId];

      if (problemCache && problemCache.code) {
        const CACHE_TIMEOUT = 30 * 60 * 1000;
        const timeDiff = new Date().getTime() - problemCache.timestamp;

        if (timeDiff < CACHE_TIMEOUT) {
          setCode(problemCache.code);
        } else {
          // Clear expired cache for this problem
          delete cachedSubmission[problemId];
          localStorage.setItem('oj-submission-cache', JSON.stringify(cachedSubmission));
        }
      }
    } catch (error) {
      console.error('Failed to read from localStorage:', error);
    }
  }, [problemId]);

  // Sync scrolling between the editor's textarea, the <pre> block, and the line numbers gutter
  useEffect(() => {
    const editorEl = editorWrapperRef.current;
    if (!editorEl) return;

    const textarea = editorEl.querySelector('textarea');
    const pre = editorEl.querySelector('pre'); // Find the <pre> block for highlighted code

    if (!textarea || !pre) return;

    const syncScroll = () => {
      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;

      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = scrollTop;
      }

      // Sync the <pre> block's scroll position to match the textarea
      pre.scrollTop = scrollTop;
      pre.scrollLeft = scrollLeft;
    };

    textarea.addEventListener('scroll', syncScroll);

    return () => {
      textarea.removeEventListener('scroll', syncScroll);
    };
  }, []); // Run only once to attach the listener

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const submitData = {
        problemId,
        language,
        code,
      };

      // Add contestId if this is a contest submission
      if (contestId) {
        submitData.contestId = contestId;
      }

      await submissionService.submit(submitData);

      try {
        const submissionCache = JSON.parse(localStorage.getItem('oj-submission-cache') || '{}');
        submissionCache[problemId] = {
          code: code,
          timestamp: new Date().getTime(),
        };
        localStorage.setItem('oj-submission-cache', JSON.stringify(submissionCache));
      } catch (error) {
        console.error('Failed to write to localStorage:', error);
      }

      // Navigate to appropriate submissions page
      if (contestId) {
        navigate(`/contests/${contestId}/submissions`);
      } else {
        navigate('/submissions');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'An unexpected error occurred.';
      setError(errorMsg);
      console.error('Error submitting code:', err);
      setIsSubmitting(false);
    }
  };

  const highlightCode = (code) => {
    try {
      return hljs.highlight(code, { language: 'cpp' }).value;
    } catch (e) {
      console.warn('Highlighting error:', e);
      return code;
    }
  };

  const lineCount = code.split('\n').length;

  const handleWrapperClick = () => {
    editorWrapperRef.current?.querySelector('textarea')?.focus();
  };

  return {
    language,
    setLanguage,
    code,
    setCode,
    isSubmitting,
    error,
    editorWrapperRef,
    lineNumbersRef,
    handleSubmit,
    highlightCode,
    lineCount,
    handleWrapperClick,
  };
};

export default useCodeSubmission;
