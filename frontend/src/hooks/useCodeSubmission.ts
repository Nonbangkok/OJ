import { useState, useRef, useEffect } from 'react';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import submissionService from '../services/submissionService';
import { APP_CONSTANTS } from '../utils/constants';
import type { SubmissionLanguage } from '../utils/constants';
import type { SubmitRequest } from '../types';
import type { FormEvent, MutableRefObject } from 'react';
import { readSubmissionCache, writeSubmissionCache } from '../utils/submissionDrafts';

// Register the highlight.js grammar for every supported language.
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('python', python);

/** Reads a dropped file as text (FileReader works in every browser and jsdom). */
const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const LANGUAGES: SubmissionLanguage[] = ['cpp', 'python'];
/** The language of this problem's most recent unexpired draft, if any. */
const draftLanguage = (problemId: string): SubmissionLanguage | null => {
  const cache = readSubmissionCache();
  let best: { language: SubmissionLanguage; at: number } | null = null;
  for (const language of LANGUAGES) {
    const draft = cache[`${problemId}:${language}`];
    if (!draft?.code || new Date().getTime() - draft.timestamp >= APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY) continue;
    if (!best || draft.timestamp > best.at) best = { language, at: draft.timestamp };
  }
  return best?.language ?? null;
};
const escapeHtml = (source: string) => source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const useCodeSubmission = (
  problemId: string,
  contestId: string | null | undefined,
  submissionFilename?: string | null,
  /** Called with the new submission's id once the judge has queued it. */
  onSubmitted?: (submissionId: number) => void,
) => {
  // No language is preselected: the student chooses. A saved draft for this
  // problem brings its language back (the most recent one), so code never vanishes.
  const [selectedLanguage, setSelectedLanguage] = useState<SubmissionLanguage | null>(() => draftLanguage(problemId));
  // Header problems are C++ only; the judge rejects anything else.
  const language: SubmissionLanguage | null = submissionFilename ? 'cpp' : selectedLanguage;
  const [code, setCode] = useState(``);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const editorWrapperRef = useRef<HTMLDivElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);

  // The cache key is per problem AND per language, so switching languages
  // never restores e.g. C++ code into the Python editor.
  const cacheKey = language ? `${problemId}:${language}` : null;

  const codeRef = useRef(code);
  useEffect(() => { codeRef.current = code; });
  /** Choosing the first language keeps whatever was typed before (it becomes that language's draft). */
  const setLanguage = (next: SubmissionLanguage) => {
    if (selectedLanguage === null && codeRef.current) {
      const cache = readSubmissionCache();
      cache[`${problemId}:${next}`] = { code: codeRef.current, timestamp: new Date().getTime() };
      writeSubmissionCache(cache);
    }
    setSelectedLanguage(next);
  };

  useEffect(() => {
    if (!cacheKey) return;
    const cachedSubmission = readSubmissionCache();
    const problemCache = cachedSubmission[cacheKey];

    if (problemCache && problemCache.code) {
      const timeDiff = new Date().getTime() - problemCache.timestamp;

      if (timeDiff < APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the cached draft from localStorage (external store) when problem/language changes, or clears the editor when there is none
        setCode(problemCache.code);
      } else {
        // Clear expired cache for this problem/language
        delete cachedSubmission[cacheKey];
        writeSubmissionCache(cachedSubmission);
      }
    } else {
      // No cached draft for this language — start from a blank editor rather
      // than keeping the other language's code around.
      setCode('');
    }
  }, [cacheKey]);

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

  const handleSubmit = async (e?: Pick<FormEvent, 'preventDefault'>) => {
    e?.preventDefault();
    if (isSubmitting) return;
    if (!language) {
      setError('Choose a language first.');
      return;
    }
    setIsSubmitting(true);
    setError('');

    try {
      const submitData: SubmitRequest = {
        problemId,
        language,
        code,
      };

      // Add contestId if this is a contest submission
      if (contestId) {
        submitData.contestId = contestId;
      }

      const response = await submissionService.submit(submitData);

      const submissionCache = readSubmissionCache();
      submissionCache[`${problemId}:${language}`] = {
        code: code,
        timestamp: new Date().getTime(),
      };
      writeSubmissionCache(submissionCache);

      // The result is shown in place (live) by the caller.
      setIsSubmitting(false);
      onSubmitted?.(response.submissionId);
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'An unexpected error occurred.';
      setError(errorMsg);
      console.error('Error submitting code:', err);
      setIsSubmitting(false);
    }
  };

  const highlightCode = (source: string): string => {
    try {
      return language ? hljs.highlight(source, { language }).value : escapeHtml(source);
    } catch (e) {
      console.warn('Highlighting error:', e);
      return source;
    }
  };

  const lineCount = code.split('\n').length;

  const handleWrapperClick = () => {
    editorWrapperRef.current?.querySelector('textarea')?.focus();
  };

  /** Loads a dropped/picked file into the editor; a .py file switches a standard problem to Python. */
  const loadFile = async (file: File) => {
    const text = await readFileText(file);
    if (!submissionFilename) {
      const next: SubmissionLanguage = file.name.toLowerCase().endsWith('.py') ? 'python' : 'cpp';
      if (next !== language) {
        // Switching language re-runs the draft-restore effect for the new key;
        // store the file as that language's draft so the restore loads it.
        const cache = readSubmissionCache();
        cache[`${problemId}:${next}`] = { code: text, timestamp: new Date().getTime() };
        writeSubmissionCache(cache);
      }
      setSelectedLanguage(next);
    }
    setCode(text);
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
    loadFile,
  };
};

export default useCodeSubmission;
