import React from 'react';
import useHomeQuotes from '../../hooks/useHomeQuotes';
import styles from './Home.module.css';

const Home: React.FC = () => {
  const {
    currentQuote,
    isWelcome,
    isFading,
    handleClick,
  } = useHomeQuotes();

  const textClassName = `${isWelcome ? styles['welcome-text'] : styles['quote-text']} ${isFading ? styles.fading : ''}`;

  return (
    <div className={styles['home-container']}>
      <div className={styles['quote-box']} onClick={handleClick}>
        <p className={textClassName}>
          {currentQuote}
        </p>
      </div>
    </div>
  );
};

export default Home; 