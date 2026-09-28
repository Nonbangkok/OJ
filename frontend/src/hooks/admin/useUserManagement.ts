import { useState, useEffect, useCallback, useRef } from 'react';
import adminService from '../../services/adminService';
import type { AdminUser } from '../../types';

/** Rows per page on the admin user list (ADMIN-008). */
export const USER_PAGE_SIZE = 100;

const useUserManagement = (search = '', roleFilter = 'all') => {
    const [users, setUsers] = useState<AdminUser[]>([]);
    // ADMIN-008: server-side paging state. Page 1 + total from the response.
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [deletingUser, setDeletingUser] = useState(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const latestRequestId = useRef(0);

    const fetchUsers = useCallback(async (pageToLoad = 1) => {
        const requestId = ++latestRequestId.current;
        try {
            setLoading(true);
            setError('');
            const data = await adminService.getUsers({
                page: pageToLoad,
                limit: USER_PAGE_SIZE,
                search: search.trim() || undefined,
                role: roleFilter as 'all' | 'user' | 'staff' | 'admin',
            });
            if (requestId !== latestRequestId.current) return;
            setUsers(data.users);
            setTotal(data.total);
            setPage(data.page);
        } catch (err) {
            if (requestId === latestRequestId.current) {
                setError('Failed to fetch users.');
                console.error(err);
            }
        } finally {
            if (requestId === latestRequestId.current) setLoading(false);
        }
    }, [search, roleFilter]);

    useEffect(() => {
        // Invalidate an in-flight request as soon as the query changes. The
        // toolbar stays mounted while the first page for the new query loads.
        latestRequestId.current += 1;
        setLoading(true);
        setError('');
        const timeout = window.setTimeout(() => fetchUsers(1), search.trim() ? 300 : 0);
        return () => {
            window.clearTimeout(timeout);
            latestRequestId.current += 1;
        };
    }, [fetchUsers, search]);

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
                setUsers((current) => current.filter(user => user.id !== deletingUser.id));
                setTotal((current) => Math.max(0, current - 1));
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
        setError,
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
