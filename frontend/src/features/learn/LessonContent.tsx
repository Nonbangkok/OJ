import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import { resolveLessonAssets } from '../../services/learnService';
import type { LearnLessonProblem } from '../../types';
import { UI_TIMEOUTS } from '../../config/constants';
import { codeForCopyButton, prepareLessonHtml, selectTab } from './lessonHtml';
import styles from './LessonContent.module.css';

export interface LessonContentProps {
  lessonSlug: string;
  /** Stored lesson HTML (sanitized by the backend at import). */
  html: string;
  problems: LearnLessonProblem[];
}

/**
 * The lesson body. The HTML is prepared once per lesson (tabs, highlighting,
 * problem cards) and rendered as one island; tab switching, copy buttons and
 * problem links are handled here by delegation.
 */
export default function LessonContent({ lessonSlug, html, problems }: LessonContentProps) {
  const navigate = useNavigate();
  const prepared = useMemo(
    () => prepareLessonHtml(resolveLessonAssets(html, lessonSlug), problems),
    [html, lessonSlug, problems],
  );

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[role="tab"][data-tab-index]');
    if (tab) {
      selectTab(tab);
      return;
    }
    const copy = target.closest<HTMLElement>('[data-lesson="copy"]');
    if (copy) {
      const code = codeForCopyButton(copy);
      void navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = 'Copied';
        window.setTimeout(() => { copy.textContent = 'Copy'; }, UI_TIMEOUTS.COPY_CLIPBOARD);
      }, () => { /* clipboard refused: nothing to show */ });
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[data-lesson-link]');
    if (link && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      navigate(link.getAttribute('href') ?? '/');
    }
  };

  // Arrow keys move between the tabs of one code-tabs group (WAI-ARIA tabs pattern).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"][data-tab-index]');
    const list = tab?.parentElement;
    if (!tab || !list) return;
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    event.preventDefault();
    selectTab(next);
    next.focus();
  };

  return (
    <div
      role="presentation"
      className={styles.content}
      onClick={onClick}
      onKeyDown={onKeyDown}
      // Sanitized by the backend at import; prepareLessonHtml only adds nodes built with DOM APIs.
      dangerouslySetInnerHTML={{ __html: prepared }}
    />
  );
}
