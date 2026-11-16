import { Desktop } from '@phosphor-icons/react';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import styles from './Workspace.module.css';

export const SMALL_SCREEN_QUERY = '(max-width: 767px)';

/** True below 768 px, where editors and uploads give way to a read-only view (§7.9 mobile policy). */
export function useSmallScreen(): boolean {
  return useMediaQuery(SMALL_SCREEN_QUERY);
}

export default function LargeScreenNotice({ detail }: { detail?: string }) {
  return (
    <div className={styles.largeScreen} role="note">
      <Desktop size={18} aria-hidden="true" />
      <div>
        <b>Best edited on a larger screen</b>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  );
}
