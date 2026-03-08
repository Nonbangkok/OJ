import { useState, useRef, useEffect } from 'react';
import hljs from 'highlight.js/lib/core';

const useSubmissionModal = (submission) => {
    const [copySuccess, setCopySuccess] = useState(false);
    const [code, setCode] = useState('');
    const [lineCount, setLineCount] = useState(1);
    const [hasScrollbar, setHasScrollbar] = useState(false);
    const lineNumbersRef = useRef(null);
    const editorWrapperRef = useRef(null);

    useEffect(() => {
        if (submission?.code) {
            setCode(submission.code);
            setLineCount(submission.code.split('\n').length);
        }
    }, [submission]);

    // Sync scrolling between line numbers and code
    useEffect(() => {
        if (!submission) return;

        const editorEl = editorWrapperRef.current;
        if (!editorEl) return;

        const textarea = editorEl.querySelector('textarea');
        const lineNumbers = lineNumbersRef.current;

        if (!textarea || !lineNumbers) return;

        // Check for scrollbar presence
        const checkScrollbar = () => {
            const isScrollbarVisible = textarea.scrollHeight > textarea.clientHeight;
            setHasScrollbar(isScrollbarVisible);
        };

        // Check initially and on any resize of the textarea
        const resizeObserver = new ResizeObserver(checkScrollbar);
        resizeObserver.observe(textarea);

        // Initial check after a short delay to allow DOM to render
        const timeoutId = setTimeout(checkScrollbar, 50);

        const syncScroll = () => {
            lineNumbers.scrollTop = textarea.scrollTop;
            const pre = editorEl.querySelector('pre');
            if (pre) {
                pre.scrollTop = textarea.scrollTop;
                pre.scrollLeft = textarea.scrollLeft;
            }
        };

        textarea.addEventListener('scroll', syncScroll);

        return () => {
            clearTimeout(timeoutId);
            resizeObserver.disconnect();
            textarea.removeEventListener('scroll', syncScroll);
        };
    }, [submission, code]);

    const handleWrapperClick = () => {
        editorWrapperRef.current?.querySelector('textarea')?.focus();
    };

    const handleCopyCode = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            console.error('Failed to copy code:', err);
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

    const getStatusClass = (status) => {
        if (!status) return '';
        return `status-${status.split(' ')[0].toLowerCase()}`;
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString();
    };

    const parseResults = () => {
        if (!submission?.results) return null;
        let results;
        try {
            results = typeof submission.results === 'string'
                ? JSON.parse(submission.results)
                : submission.results;
        } catch (e) {
            return 'error';
        }
        if (!Array.isArray(results) || results.length === 0) return [];
        return results;
    };

    const parsedResults = parseResults();

    return {
        copySuccess,
        code,
        lineCount,
        hasScrollbar,
        lineNumbersRef,
        editorWrapperRef,
        handleWrapperClick,
        handleCopyCode,
        highlightCode,
        getStatusClass,
        formatDate,
        parsedResults,
    };
};

export default useSubmissionModal;
