import { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';

const useUserManagement = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [deletingUser, setDeletingUser] = useState(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const fetchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminService.getUsers();
            setUsers(data);
        } catch (err) {
            setError('Failed to fetch users.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleEdit = (user) => {
        setEditingUser(user);
    };

    const handleDeleteClick = (user) => {
        setDeletingUser(user);
    };

    const handleConfirmDelete = async () => {
        if (deletingUser) {
            try {
                await adminService.deleteUser(deletingUser.id);
                setUsers(users.filter(user => user.id !== deletingUser.id));
            } catch (err) {
                setError('Failed to delete user.');
                console.error(err);
            } finally {
                setDeletingUser(null);
            }
        }
    };

    const handleSave = async (userId, userData) => {
        try {
            await adminService.updateUser(userId, userData);
            setEditingUser(null);
            fetchUsers();
        } catch (err) {
            setError('Failed to save user details.');
            console.error(err);
        }
    };

    const handleAddNewUser = async (newUserData) => {
        try {
            await adminService.createUser(newUserData);
            setIsAddModalOpen(false);
            fetchUsers();
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to create user.');
            console.error(err);
        }
    };

    return {
        users,
        loading,
        error,
        editingUser,
        setEditingUser,
        deletingUser,
        setDeletingUser,
        isAddModalOpen,
        setIsAddModalOpen,
        fetchUsers,
        handleEdit,
        handleDeleteClick,
        handleConfirmDelete,
        handleSave,
        handleAddNewUser
    };
};

export default useUserManagement;
