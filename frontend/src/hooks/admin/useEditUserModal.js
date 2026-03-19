import { useState, useEffect } from 'react';

const useEditUserModal = (user, onClose, onSave) => {
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

    const handleChange = (e) => {
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
