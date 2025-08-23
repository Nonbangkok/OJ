import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../components/Table.css'; // Use the new shared table styles

const Scoreboard = () => {
  const [scoreboard, setScoreboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchScoreboard = async () => {
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/scoreboard`, { withCredentials: true });
        setScoreboard(response.data);
      } catch (err) {
        setError('Failed to fetch scoreboard. Please log in.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchScoreboard();
  }, []);

  if (loading) return <div>Loading scoreboard...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="scoreboard-container">
      <h1>Scoreboard</h1>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>User</th>
              <th>Problems Solved</th>
              <th>Total Score</th>
            </tr>
          </thead>
          <tbody>
            {scoreboard.map((user, index) => (
              <tr key={user.username} className={index < 3 ? `rank-${index + 1}` : ''}>
                <td>{index + 1}</td>
                <td>{user.username}</td>
                <td>{user.problems_solved}</td>
                <td>{user.total_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Scoreboard; 