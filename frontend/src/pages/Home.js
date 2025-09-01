import React, { useState } from 'react';
import styles from './Home.module.css';

const quotes = [
  "Have you solved any problems today?",
  "Beautiful algorithms are like poetry that actually works",
  "Don't give up to 'Time Limit Exceeded'",
  "Success is the sum of small efforts repeated day in and day out",
  "Every line of code is a small step towards great achievement",
  "Write code like poetry, debug like a detective",
  "A good programmer is someone who efficiently lazy",
  "Compilation errors aren't a big problem... just haven't found the missing semicolon yet",
  "Stack Overflow is a true friend in hard times",
  "Never stop learning, because technology never stops evolving",
  "The messier the code, the more fun debugging becomes (?!)",
  "Write tests before code, like having a safety net",
  "Coffee: the main fuel of programmers",
  "Every error is a lesson, fish live in water",
  "Sleep with bugs, wake up with solutions",
  "Don't be afraid to delete old code",
  "Refactor until you're satisfied",
  "The best code is code that wasn't written",
  "Good algorithms might be worth more than the most powerful hardware",
  "Fixing bugs is like finding a needle in an ocean... that we dropped ourselves",
  "Don't optimize if it doesn't work yet",
  "Sometimes the best solution is to sleep",
  "Every commit is recording history",
  "Documentation is a love letter to your future self",
  "If it works, don't touch it... (this is bad advice)"
];

const Home = () => {
  const [currentQuote, setCurrentQuote] = useState("Welcome");
  const [isWelcome, setIsWelcome] = useState(true);
  const [isFading, setIsFading] = useState(false);

  const getRandomQuote = () => {
    // Prevent showing the same quote twice in a row
    let newQuote;
    do {
      newQuote = quotes[Math.floor(Math.random() * quotes.length)];
    } while (newQuote === currentQuote);
    return newQuote;
  };

  const handleClick = () => {
    if (isFading) return; // Prevent clicking while animating

    setIsFading(true); // Start fade out

    setTimeout(() => {
      if (isWelcome) {
        setIsWelcome(false);
      }
      setCurrentQuote(getRandomQuote());
      setIsFading(false); // Start fade in
    }, 300); // Match CSS transition duration
  };

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