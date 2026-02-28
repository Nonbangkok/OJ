import { useState, useEffect } from 'react';
import problemService from '../services/problemService';

export const useProblems = () => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProblems = async () => {
    try {
      setLoading(true);
      const data = await problemService.getAllWithStats();
      setProblems(data);
    } catch (err) {
      setError('Failed to fetch problems. Please log in.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProblems();
  }, []);

  return { problems, loading, error, refresh: fetchProblems };
};