import React from 'react';
import { Outlet } from 'react-router-dom';
import ContestNavbar from './ContestNavbar';

function ContestLayout() {
  return (
    <>
      <ContestNavbar />
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}

export default ContestLayout;
