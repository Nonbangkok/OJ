import { useState, useEffect, useRef } from 'react';
import adminService from '../../services/adminService';
import type { Problem, User } from '../../types';

const useProblemModal = (problem: Problem | null, onSave: ({ problemData, pdfFile, zipFile }: { problemData: any; pdfFile?: File; zipFile?: File }) => Promise<void>, uploadProgress: any, currentUser: User | null) => {
    const [formData, setFormData] = useState({
        id: '',
        title: '',
        author: '',
        timeLimit: 2000,
        memoryLimit: 512,
    });
    const [authors, setAuthors] = useState<User[]>([]);
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [zipFile, setZipFile] = useState<File | null>(null);
    const pdfRef = useRef<HTMLInputElement>(null);
    const zipRef = useRef<HTMLInputElement>(null);

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
                id: String(problem.id),
                title: problem.title ?? '',
                author: problem.author || '',
                timeLimit: problem.timeLimit ?? 3000,
                memoryLimit: problem.memoryLimit ?? 256,
            });
        } else {
            // Reset form for creating new problem
            setFormData({
                id: '',
                title: '',
                author: currentUser?.username || '',
                timeLimit: 1000,
                memoryLimit: 256,
            });
        }
        // Clear file inputs on open
        if (pdfRef.current) pdfRef.current.value = '';
        if (zipRef.current) zipRef.current.value = '';
        setPdfFile(null);
        setZipFile(null);
    }, [problem, currentUser?.username]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
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
            ...(pdfFile && { pdfFile }),
            ...(zipFile && { zipFile }),
        });
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
