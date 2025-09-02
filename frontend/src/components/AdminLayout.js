import React from 'react';
import { Outlet } from 'react-router-dom';
import AdminNavbar from './AdminNavbar';

const AdminLayout = () => {
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