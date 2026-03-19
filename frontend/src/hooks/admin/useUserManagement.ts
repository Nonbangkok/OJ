import { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';
import type { User } from '../../types';

interface CreateUser {
  username: string;
  password: string;
  role: User['role'];
}

interface UseUserManagementReturn {
    users: User[];
    loading: boolean;
    error: string;
    editingUser: User | null;
    setEditingUser: (user: User | null) => void;
    deletingUser: User | null;
    setDeletingUser: (user: User | null) => void;
    isAddModalOpen: boolean;
    setIsAddModalOpen: (isOpen: boolean) => void;
    fetchUsers: () => Promise<void>;
    handleEdit: (user: User) => void;
    handleDeleteClick: (user: User) => void;
    handleConfirmDelete: () => Promise<void>;
    handleSave: (userId: string | number, userData: Partial<User>) => Promise<void>;
    handleAddNewUser: (newUserData: CreateUser) => Promise<void>;
}

const useUserManagement = (): UseUserManagementReturn => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [deletingUser, setDeletingUser] = useState<User | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

    const fetchUsers = useCallback(async (): Promise<void> => {
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

    const handleEdit = (user: User): void => {
        setEditingUser(user);
    };

    const handleDeleteClick = (user: User): void => {
        setDeletingUser(user);
    };

    const handleConfirmDelete = async (): Promise<void> => {
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

    const handleSave = async (userId: string | number, userData: Partial<User>): Promise<void> => {
        try {
            await adminService.updateUser(userId, userData);
            setEditingUser(null);
            fetchUsers();
        } catch (err) {
            setError('Failed to save user details.');
            console.error(err);
        }
    };

    const handleAddNewUser = async (newUserData: CreateUser): Promise<void> => {
        try {
            await adminService.createUser(newUserData as Partial<User>);
            setIsAddModalOpen(false);
            fetchUsers();
        } catch (err: any) {
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
