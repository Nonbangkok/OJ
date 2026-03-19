import React from 'react';
import { Outlet } from 'react-router-dom';
import ContestNavbar from './ContestNavbar';

const ContestLayout: React.FC = () => {
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
