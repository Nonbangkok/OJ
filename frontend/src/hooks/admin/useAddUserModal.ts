import { useState } from 'react';
import type { User } from '../../types';

interface CreateUser {
  username: string;
  password: string;
  role: User['role'];
}

const useAddUserModal = (onSave: (userData: CreateUser) => Promise<void>) => {
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
        onSave({ username, password, role: role as User['role'] });
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
