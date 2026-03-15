import { useState, useEffect, useRef } from 'react';
import adminService from '../../services/adminService';

const useProblemModal = (problem, onSave, uploadProgress, currentUser) => {
    const [formData, setFormData] = useState({
        id: '',
        title: '',
        author: '',
        time_limit_ms: 2000,
        memory_limit_mb: 512,
    });
    const [authors, setAuthors] = useState([]);
    const [pdfFile, setPdfFile] = useState(null);
    const [zipFile, setZipFile] = useState(null);
    const pdfRef = useRef();
    const zipRef = useRef();

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
                time_limit_ms: problem.time_limit_ms ?? 3000,
                memory_limit_mb: problem.memory_limit_mb ?? 256,
            });
        } else {
            // Reset form for creating new problem
            setFormData({
                id: '',
                title: '',
                author: currentUser?.username ?? '',
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
        }));
    };

    const handleSave = () => {
        // Pass the collected data back to the parent component
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
        handleSave
    };
};

export default useProblemModal;
