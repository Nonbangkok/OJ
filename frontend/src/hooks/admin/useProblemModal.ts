import { useState, useEffect, useRef, useCallback } from 'react';
import adminService from '../../services/adminService';
import type { ProblemFilesResponse } from '../../types';

export const DEFAULT_SUBMISSION_FILENAME = 'student.h';
export const TYPE_LOCK_MESSAGE = 'Problem type and submission filename cannot change after submissions exist.';

const buildProblemForm = (problem, username) => {
    if (problem) {
        return {
            id: problem.id,
            title: problem.title ?? '',
            author: problem.author ?? '',
            categories: problem.categories ?? [],
            collection_id: problem.collection_id ?? null,
            difficulty: problem.difficulty ?? null,
            time_limit_ms: problem.time_limit_ms ?? 3000,
            memory_limit_mb: problem.memory_limit_mb ?? 256,
            problem_type: problem.problem_type ?? 'standard',
            submission_filename: problem.submission_filename ?? DEFAULT_SUBMISSION_FILENAME,
        };
    }
    // Fresh form for creating a new problem
    return {
        id: '',
        title: '',
        author: username ?? '',
        categories: [],
        collection_id: null,
        difficulty: null,
        time_limit_ms: 1000,
        memory_limit_mb: 256,
        problem_type: 'standard',
        submission_filename: DEFAULT_SUBMISSION_FILENAME,
    };
};

const useProblemModal = (problem, onSave, uploadProgress, currentUser) => {
    const [formData, setFormData] = useState(() => buildProblemForm(problem, currentUser?.username));
    const [authors, setAuthors] = useState([]);
    const [validationError, setValidationError] = useState('');
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [zipFile, setZipFile] = useState<File | null>(null);
    const pdfRef = useRef<HTMLInputElement | null>(null);
    const zipRef = useRef<HTMLInputElement | null>(null);

    const isEditing = !!problem;
    const problemId = problem?.id;
    // The saved type + files come from the files endpoint (the list rows do
    // not carry them); `null` until it answers or if it fails.
    const [filesInfo, setFilesInfo] = useState<ProblemFilesResponse | null>(null);
    const isUploading = uploadProgress && !['completed', 'failed'].includes(uploadProgress.status);

    useEffect(() => {
        const fetchAuthors = async () => {
            try {
                const data = await adminService.getAuthors();
                setAuthors(data);
            } catch (err) {
                console.error("Failed to fetch authors", err);
            }
        };
        fetchAuthors();
    }, []);

    // Resolves to the saved type + files, or undefined when unavailable.
    const fetchFiles = useCallback(async (): Promise<ProblemFilesResponse | undefined> => {
        if (!problemId) return undefined;
        try {
            return (await adminService.getProblemFiles(problemId)) || undefined;
        } catch (err) {
            console.error('Failed to fetch problem files', err);
            return undefined;
        }
    }, [problemId]);

    const loadFiles = useCallback(async () => {
        const info = await fetchFiles();
        if (info) setFilesInfo(info);
        return info;
    }, [fetchFiles]);

    useEffect(() => {
        let cancelled = false;
        fetchFiles().then((info) => {
            if (cancelled || !info) return;
            setFilesInfo(info);
            setFormData(prev => ({
                ...prev,
                problem_type: info.problem_type,
                submission_filename: info.submission_filename ?? DEFAULT_SUBMISSION_FILENAME,
            }));
        });
        return () => { cancelled = true; };
    }, [fetchFiles]);

    // Re-seed the form and drop picked files whenever the edited problem (or
    // the default author for a new one) changes. Adjusted during render; the
    // initial form comes from the lazy init above.
    const currentUsername = currentUser?.username;
    const [formSource, setFormSource] = useState({ problem, username: currentUsername });
    if (formSource.problem !== problem || formSource.username !== currentUsername) {
        setFormSource({ problem, username: currentUsername });
        // The saved type only comes from the files endpoint, so keep it across a re-seed.
        setFormData({
            ...buildProblemForm(problem, currentUsername),
            ...(problem && filesInfo ? {
                problem_type: filesInfo.problem_type,
                submission_filename: filesInfo.submission_filename ?? DEFAULT_SUBMISSION_FILENAME,
            } : {}),
        });
        setPdfFile(null);
        setZipFile(null);
    }

    // Clear the native file inputs on open / when the form is re-seeded.
    useEffect(() => {
        if (pdfRef.current) pdfRef.current.value = null;
        if (zipRef.current) zipRef.current.value = null;
    }, [problem, currentUsername]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setValidationError('');
        setFormData(prev => ({
            ...prev,
            // Keep the input value editable while typing; numeric limits are
            // parsed and validated before they cross the API boundary.
            [name]: value,
            // Difficulty is tri-state: '' = Unrated (null), otherwise the
            // numeric rating from the dropdown.
            ...(name === 'difficulty' ? { difficulty: value === '' ? null : Number(value) } : {}),
        }));
    };

    // Categories are a checkbox grid: toggling one adds/removes it, always
    // sorted so equal sets compare equal (mirrors the backend normalization).
    const handleCategoryToggle = (category, checked) => {
        setFormData(prev => ({
            ...prev,
            categories: checked
                ? [...prev.categories, category].sort()
                : prev.categories.filter(c => c !== category),
        }));
    };

    const handleSave = () => {
        const timeLimit = Number(formData.time_limit_ms);
        const memoryLimit = Number(formData.memory_limit_mb);
        if (!Number.isInteger(timeLimit) || timeLimit < 100) {
            setValidationError('Time Limit must be a whole number of at least 100 ms.');
            return;
        }
        if (!Number.isInteger(memoryLimit) || memoryLimit < 1) {
            setValidationError('Memory Limit must be a whole number of at least 1 MB.');
            return;
        }

        const { problem_type, submission_filename, ...rest } = formData;
        const isHeader = problem_type === 'header';
        // Type fields go out for header problems, or when an existing header
        // problem is switched back; otherwise omitted so standard saves (and
        // edits made before the type loaded) never touch the locked fields.
        const sendType = isHeader || (isEditing && filesInfo?.problem_type === 'header');
        const filename = String(submission_filename).trim();
        if (isHeader && !filename) {
            setValidationError('Submission filename is required for header problems.');
            return;
        }

        // Send numeric values matching the backend schema, not DOM strings.
        onSave({
            problemData: {
                ...rest,
                time_limit_ms: timeLimit,
                memory_limit_mb: memoryLimit,
                ...(sendType ? { problem_type, submission_filename: isHeader ? filename : null } : {}),
            },
            pdfFile,
            zipFile,
        }, isEditing);
    };

    return {
        formData,
        authors,
        validationError,
        pdfFile,
        setPdfFile,
        zipFile,
        setZipFile,
        pdfRef,
        zipRef,
        isEditing,
        isUploading,
        filesInfo,
        loadFiles,
        handleChange,
        handleCategoryToggle,
        handleSave
    };
};

export default useProblemModal;
