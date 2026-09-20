import { useState, useEffect, useRef } from 'react';
import adminService from '../../services/adminService';

const useProblemModal = (problem, onSave, uploadProgress, currentUser) => {
    const [formData, setFormData] = useState({
        id: '',
        title: '',
        author: '',
        categories: [],
        difficulty: null,
        time_limit_ms: 2000,
        memory_limit_mb: 512,
    });
    const [authors, setAuthors] = useState([]);
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [zipFile, setZipFile] = useState<File | null>(null);
    const pdfRef = useRef<HTMLInputElement | null>(null);
    const zipRef = useRef<HTMLInputElement | null>(null);

    const isEditing = !!problem;
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

    useEffect(() => {
        if (problem) {
            setFormData({
                id: problem.id,
                title: problem.title ?? '',
                author: problem.author ?? '',
                categories: problem.categories ?? [],
                difficulty: problem.difficulty ?? null,
                time_limit_ms: problem.time_limit_ms ?? 3000,
                memory_limit_mb: problem.memory_limit_mb ?? 256,
            });
        } else {
            // Reset form for creating new problem
            setFormData({
                id: '',
                title: '',
                author: currentUser?.username ?? '',
                categories: [],
                difficulty: null,
                time_limit_ms: 1000,
                memory_limit_mb: 256,
            });
        }
        // Clear file inputs on open
        if (pdfRef.current) pdfRef.current.value = null;
        if (zipRef.current) zipRef.current.value = null;
        setPdfFile(null);
        setZipFile(null);
    }, [problem, currentUser?.username]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            // Treat all form values as strings. The backend will handle parsing.
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
        // Pass the collected data back to the parent component.
        onSave({
            problemData: formData,
            pdfFile,
            zipFile,
        }, isEditing);
    };

    return {
        formData,
        authors,
        pdfFile,
        setPdfFile,
        zipFile,
        setZipFile,
        pdfRef,
        zipRef,
        isEditing,
        isUploading,
        handleChange,
        handleCategoryToggle,
        handleSave
    };
};

export default useProblemModal;
