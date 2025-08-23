import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import '../components/Form.css'; // Use the new shared form styles

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await axios.post('http://localhost:3000/login', { username, password }, {
        withCredentials: true
      });

      // Assuming a successful login redirects to the home page
      // If you need to handle specific success messages, you'd set them here
      // For now, we'll just redirect
      navigate('/');
    } catch (error) {
      if (error.response && error.response.data) {
        setError(error.response.data.message || 'Login failed');
      } else {
        setError('An error occurred during login');
      }
    }
  };

  return (
    <div className="sign-in-form-container">
      <h2>Login</h2>
      <form onSubmit={handleSubmit}>
        {error && <p className="error-message">{error}</p>}
        <div className="form-group">
          <label htmlFor="username">Username or Email</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit">Login</button>
      </form>
      <p className="form-footer-link">
        Don't have an account? <Link to="/register">Register here</Link>
      </p>
    </div>
  );
};

export default Login; 