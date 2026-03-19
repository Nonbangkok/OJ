import { useState, useEffect } from 'react';
import type { User } from '../../types';

const useEditUserModal = (user: User, onClose: () => void, onSave: (userId: string | number, userData: Partial<User>) => void) => {
    const [formData, setFormData] = useState({
        username: user?.username || '',
        role: user?.role || 'user',
    });

    useEffect(() => {
        if (user) {
            setFormData({
                username: user.username,
                role: user.role,
            });
        }
    }, [user]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { id, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [id]: value,
        }));
    };

    const handleSave = () => {
        onSave(user.id, formData);
        onClose();
    };

    return {
        formData,
        handleChange,
        handleSave,
    };
};

export default useEditUserModal;
