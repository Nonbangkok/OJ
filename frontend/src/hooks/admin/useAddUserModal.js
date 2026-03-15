import { useState } from 'react';

const useAddUserModal = (onSave) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('user');
    const [error, setError] = useState('');

    const handleSave = () => {
        if (username.length < 3) {
            setError('Username must be at least 3 characters long.');
            return;
        }
        if (password.length < 6) {
            setError('Password must be at least 6 characters long.');
            return;
        }
        setError('');
        onSave({ username, password, role });
    };

    return {
        username,
        setUsername,
        password,
        setPassword,
        role,
        setRole,
        error,
        setError,
        handleSave
    };
};

export default useAddUserModal;
