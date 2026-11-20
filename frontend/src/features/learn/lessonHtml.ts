import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import type { LearnLessonProblem } from '../../types';

/**
 * Turns a lesson's stored HTML (sanitized at import, spec §4) into the HTML the
 * page renders. Pure: it parses, rewrites and serializes, so the page can render
 * it with one innerHTML and handle the interactive bits by event delegation.
 *
 * - `[data-lesson="code-tabs"]` → a tab list (one tab per fenced block) + panels.
 * - every `pre > code.language-*` → highlight.js markup (escaped by highlight.js).
 * - `[data-lesson="problem"]` → a problem card built from the lesson's problem list,
 *   or "Problem unavailable" when the viewer may not see it.
 *
 * Everything this adds is created with DOM APIs (textContent / setAttribute), so
 * problem titles and code are always text, never markup.
 */

hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('python', python);

const LANGUAGE_LABELS: Record<string, string> = { cpp: 'C++', 'c++': 'C++', python: 'Python', py: 'Python' };
const ROLE_LABELS: Record<LearnLessonProblem['role'], string> = { example: 'Example', practice: 'Practice', challenge: 'Challenge' };
const STATUS_LABELS: Record<NonNullable<LearnLessonProblem['status']>, string> = {
  solved: 'Solved', attempted: 'Attempted', not_tried: 'Not tried',
};

export const problemPath = (id: string): string => `/problems/${encodeURIComponent(id)}`;

const languageOf = (code: Element): string | null => {
  const match = /(?:^|\s)language-([A-Za-z0-9_+-]+)/.exec(code.getAttribute('class') ?? '');
  return match ? match[1].toLowerCase() : null;
};

function highlight(doc: Document, code: Element): void {
  const language = languageOf(code);
  const text = code.textContent ?? '';
  const grammar = language && hljs.getLanguage(language) ? language : null;
  code.setAttribute('class', `hljs${language ? ` language-${language}` : ''}`);
  if (!grammar) {
    code.textContent = text;
    return;
  }
  // highlight.js escapes the source; its output contains only <span class="hljs-*">.
  const highlighted = doc.createElement('template');
  highlighted.innerHTML = hljs.highlight(text, { language: grammar, ignoreIllegals: true }).value;
  code.replaceChildren(highlighted.content);
}

let tabsCounter = 0;

function buildTabs(doc: Document, container: Element): void {
  const blocks = [...container.children].filter((child) => child.tagName === 'PRE' && child.querySelector('code'));
  if (blocks.length === 0) return;
  tabsCounter += 1;
  const base = `lesson-tabs-${tabsCounter}`;

  const bar = doc.createElement('div');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('data-lesson', 'tab-list');
  const panels = blocks.map((pre, index) => {
    const code = pre.querySelector('code');
    const language = code ? languageOf(code) : null;
    const tab = doc.createElement('button');
    tab.setAttribute('type', 'button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('id', `${base}-tab-${index}`);
    tab.setAttribute('aria-controls', `${base}-panel-${index}`);
    tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    tab.setAttribute('tabindex', index === 0 ? '0' : '-1');
    tab.setAttribute('data-tab-index', String(index));
    tab.textContent = (language && LANGUAGE_LABELS[language]) ?? language ?? `Code ${index + 1}`;
    bar.append(tab);

    const panel = doc.createElement('div');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('id', `${base}-panel-${index}`);
    panel.setAttribute('aria-labelledby', `${base}-tab-${index}`);
    panel.setAttribute('data-tab-panel', String(index));
    if (index !== 0) panel.setAttribute('hidden', '');
    panel.append(pre);
    return panel;
  });

  const copy = doc.createElement('button');
  copy.setAttribute('type', 'button');
  copy.setAttribute('data-lesson', 'copy');
  copy.textContent = 'Copy';
  bar.append(copy);

  container.replaceChildren(bar, ...panels);
}

function wrapStandaloneCode(doc: Document, pre: Element): void {
  if (pre.closest('[data-lesson="code-tabs"]')) return;
  const frame = doc.createElement('div');
  frame.setAttribute('data-lesson', 'code');
  const copy = doc.createElement('button');
  copy.setAttribute('type', 'button');
  copy.setAttribute('data-lesson', 'copy');
  copy.textContent = 'Copy';
  pre.replaceWith(frame);
  frame.append(copy, pre);
}

function span(doc: Document, attribute: string, text: string): HTMLSpanElement {
  const element = doc.createElement('span');
  element.setAttribute('data-part', attribute);
  element.textContent = text;
  return element;
}

function buildProblemCard(doc: Document, slot: Element, problem: LearnLessonProblem | undefined): void {
  slot.replaceChildren();
  if (!problem || !problem.available || !problem.id) {
    slot.setAttribute('data-state', 'unavailable');
    slot.append(span(doc, 'mark', ''), span(doc, 'title', 'Problem unavailable'));
    slot.append(span(doc, 'note', 'It is hidden or part of a running contest right now.'));
    return;
  }
  const status = problem.status ?? 'none';
  slot.setAttribute('data-state', status);
  const mark = span(doc, 'mark', '');
  mark.setAttribute('aria-label', problem.status ? STATUS_LABELS[problem.status] : '');
  if (!problem.status) mark.setAttribute('aria-hidden', 'true');
  slot.append(mark);

  const text = doc.createElement('span');
  text.setAttribute('data-part', 'text');
  text.append(span(doc, 'eyebrow', `Try it · ${ROLE_LABELS[problem.role]}`));
  const line = doc.createElement('span');
  line.setAttribute('data-part', 'line');
  line.append(span(doc, 'id', problem.id), span(doc, 'title', problem.title ?? problem.id));
  text.append(line);
  slot.append(text);

  if (problem.difficulty !== null) slot.append(span(doc, 'difficulty', String(problem.difficulty)));
  if (problem.bestScore !== null) slot.append(span(doc, 'score', `${problem.bestScore} pts`));

  const link = doc.createElement('a');
  link.setAttribute('href', problemPath(problem.id));
  link.setAttribute('data-lesson-link', '');
  link.textContent = 'Open problem';
  slot.append(link);
}

/** Rewrite stored lesson HTML for display. `problems` is the lesson's problem list from the API. */
export function prepareLessonHtml(html: string, problems: LearnLessonProblem[]): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const body = doc.body;
  const byId = new Map(problems.flatMap((p) => (p.id ? [[p.id, p] as const] : [])));

  body.querySelectorAll('pre > code').forEach((code) => highlight(doc, code));
  body.querySelectorAll('[data-lesson="code-tabs"]').forEach((tabs) => buildTabs(doc, tabs));
  body.querySelectorAll('pre').forEach((pre) => wrapStandaloneCode(doc, pre));
  body.querySelectorAll('[data-lesson="problem"]').forEach((slot) => {
    buildProblemCard(doc, slot, byId.get(slot.getAttribute('data-problem') ?? ''));
  });
  return body.innerHTML;
}

/**
 * Switch a code-tabs group to the clicked tab. Called from the page's delegated
 * click handler; it only toggles attributes inside the lesson content.
 */
export function selectTab(tab: HTMLElement): void {
  const group = tab.closest('[data-lesson="code-tabs"]');
  if (!group) return;
  const index = tab.getAttribute('data-tab-index');
  group.querySelectorAll<HTMLElement>('[role="tab"]').forEach((other) => {
    const selected = other === tab;
    other.setAttribute('aria-selected', selected ? 'true' : 'false');
    other.setAttribute('tabindex', selected ? '0' : '-1');
  });
  group.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-tab-panel') !== index;
  });
}

/** The code a copy button refers to: the visible panel of its tabs, or its own block. */
export function codeForCopyButton(button: HTMLElement): string {
  const tabs = button.closest('[data-lesson="code-tabs"]');
  if (tabs) {
    const visible = [...tabs.querySelectorAll<HTMLElement>('[data-tab-panel]')].find((panel) => !panel.hidden);
    return visible?.querySelector('code')?.textContent ?? '';
  }
  return button.closest('[data-lesson="code"]')?.querySelector('code')?.textContent ?? '';
}
