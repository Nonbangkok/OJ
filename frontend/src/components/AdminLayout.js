import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import AdminNavbar from './AdminNavbar';
import { useAuth } from '../context/AuthContext';

const AdminLayout = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading admin layout...</div>;
  }

  if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <AdminNavbar />
      <main className="container">
        <Outlet />
      </main>
    </>
  );
};

export default AdminLayout; 