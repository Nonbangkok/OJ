import { useState } from 'react';

const useEditUserModal = (user, onClose, onSave) => {
    const [formData, setFormData] = useState(() => (user
        ? { username: user.username, role: user.role }
        : { username: '', role: 'user' }));

    // Re-seed the form when a different user is being edited (a null user
    // keeps the current form). Adjusted during render instead of an effect.
    const [formUser, setFormUser] = useState(user);
    if (user !== formUser) {
        setFormUser(user);
        if (user) {
            setFormData({
                username: user.username,
                role: user.role,
            });
        }
    }

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
