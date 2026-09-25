import { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';
import type { AdminUser } from '../../types';

/** Rows per page on the admin user list (ADMIN-008). */
export const USER_PAGE_SIZE = 100;

const useUserManagement = () => {
    const [users, setUsers] = useState<AdminUser[]>([]);
    // ADMIN-008: server-side paging state. Page 1 + total from the response.
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [deletingUser, setDeletingUser] = useState(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const fetchUsers = useCallback(async (pageToLoad = 1) => {
        try {
            setLoading(true);
            const data = await adminService.getUsers({ page: pageToLoad, limit: USER_PAGE_SIZE });
            setUsers(data.users);
            setTotal(data.total);
            setPage(data.page);
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

    // Re-throw so AddUserModal can surface the failure inline (duplicate
    // username, validation error…) while keeping the dialog open. Setting
    // the page-level `error` here would unmount the whole management view
    // and silently dismiss the modal with the typed values.
    const handleAddNewUser = async (newUserData) => {
        await adminService.createUser(newUserData);
        setIsAddModalOpen(false);
        fetchUsers();
    };

    return {
        users,
        page,
        total,
        loading,
        error,
        editingUser,
        setEditingUser,
        deletingUser,
        setDeletingUser,
        isAddModalOpen,
        setIsAddModalOpen,
        fetchUsers,
        /** Load a specific page (1-based) of the server-paged list. */
        goToPage: (nextPage: number) => fetchUsers(nextPage),
        handleEdit,
        handleDeleteClick,
        handleConfirmDelete,
        handleSave,
        handleAddNewUser
    };
};

export default useUserManagement;
