import { Outlet } from 'react-router-dom';
import ContestNavbar from './ContestNavbar';

const ContestLayout = () => {
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
