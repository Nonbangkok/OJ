import { ReactNode } from 'react';
import styles from './ChartCard.module.css';

interface ChartCardProps {
  title: string;
  children: ReactNode;
}

/** Card wrapper giving every analysis chart a consistent title + frame. */
const ChartCard = ({ title, children }: ChartCardProps) => (
  <div className={styles.card}>
    <h3 className={styles.title}>{title}</h3>
    <div className={styles['chart-area']}>{children}</div>
  </div>
);

export default ChartCard;
