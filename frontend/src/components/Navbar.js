import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Navbar.css';
import ThemeToggleButton from './ThemeToggleButton'; // Import the button

const Navbar = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await axios.get('http://localhost:3000/me', {
        withCredentials: true
      });
      setIsAuthenticated(response.data.isAuthenticated);
      if (response.data.isAuthenticated) {
        setUser(response.data.user);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('http://localhost:3000/logout', {}, {
        withCredentials: true
      });
      setIsAuthenticated(false);
      setUser(null);
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="nav-brand">Online Judge</Link>
        <ul className="nav-links">
          <li><Link to="/problems">Problems</Link></li>
          <li><Link to="/submissions">Submissions</Link></li>
          <li><Link to="/scoreboard">Scoreboard</Link></li>
          {(user?.role === 'admin' || user?.role === 'staff') && (
            <li><Link to="/admin">Admin Panel</Link></li>
          )}
        </ul>
        <div className="nav-actions">
          {isAuthenticated ? (
            <>
              <span className="username">Welcome, {user?.username}</span>
              <button onClick={handleLogout} className="logout-btn">Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-action-link">Login</Link>
              <Link to="/register" className="nav-action-link">Register</Link>
            </>
          )}
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 