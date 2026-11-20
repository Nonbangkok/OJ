import { codeForCopyButton, prepareLessonHtml, problemPath, selectTab } from '../../../features/learn/lessonHtml';
import type { LearnLessonProblem } from '../../../types';

const problem = (overrides: Partial<LearnLessonProblem> = {}): LearnLessonProblem => ({
  position: 1, role: 'example', available: true, id: 'P0002', title: 'Range Sum', difficulty: 900,
  problemType: 'standard', status: 'solved', bestScore: 100, caseStatuses: ['Accepted'], ...overrides,
});

const mount = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
};

const TABS = '<div data-lesson="code-tabs"><pre><code class="language-cpp">int x = 1;</code></pre>'
  + '<pre><code class="language-python">x = 1</code></pre></div>';

describe('prepareLessonHtml', () => {
  it('turns code-tabs into an accessible tab list with highlighted panels', () => {
    const root = mount(prepareLessonHtml(TABS, []));
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['C++', 'Python']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels.map((p) => p.hidden)).toEqual([false, true]);
    expect(panels[0].getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(root.querySelector('code.hljs .hljs-type, code.hljs .hljs-keyword')).not.toBeNull();
  });

  it('switches tabs and copies the visible panel', () => {
    const root = mount(prepareLessonHtml(TABS, []));
    const [, python] = root.querySelectorAll<HTMLElement>('[role="tab"]');
    selectTab(python);
    expect(python.getAttribute('aria-selected')).toBe('true');
    expect(python.tabIndex).toBe(0);
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels.map((p) => p.hidden)).toEqual([true, false]);
    expect(codeForCopyButton(root.querySelector<HTMLElement>('[data-lesson="copy"]')!)).toBe('x = 1');
  });

  it('frames a standalone block with its own copy button and keeps code as text', () => {
    const root = mount(prepareLessonHtml('<pre><code class="language-cpp">a &lt;b&gt; c</code></pre>', []));
    const copy = root.querySelector<HTMLElement>('[data-lesson="code"] > [data-lesson="copy"]')!;
    expect(codeForCopyButton(copy)).toBe('a <b> c');
    expect(root.querySelector('b')).toBeNull();
  });

  it('leaves unknown languages unhighlighted', () => {
    const root = mount(prepareLessonHtml('<pre><code class="language-rust">fn main() {}</code></pre><pre><code>plain</code></pre>', []));
    const codes = root.querySelectorAll('code');
    expect(codes[0].className).toBe('hljs language-rust');
    expect(codes[0].children).toHaveLength(0);
    expect(codes[1].className).toBe('hljs');
  });

  it('builds a problem card from the lesson problem list with the title as text', () => {
    const root = mount(prepareLessonHtml(
      '<div data-lesson="problem" data-problem="P0002"></div>',
      [problem({ title: '<img src=x onerror=alert(1)>', status: 'attempted', bestScore: 60 })],
    ));
    const card = root.querySelector('[data-lesson="problem"]')!;
    expect(card.getAttribute('data-state')).toBe('attempted');
    expect(card.querySelector('[data-part="title"]')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('[data-part="eyebrow"]')!.textContent).toBe('Try it · Example');
    expect(card.querySelector('[data-part="score"]')!.textContent).toBe('60 pts');
    expect(card.querySelector('a')!.getAttribute('href')).toBe('/problems/P0002');
    expect(card.querySelector('[data-part="mark"]')!.getAttribute('aria-label')).toBe('Attempted');
  });

  it('shows "Problem unavailable" when the viewer cannot see the problem', () => {
    const root = mount(prepareLessonHtml(
      '<div data-lesson="problem" data-problem="P0003"></div><div data-lesson="problem" data-problem="P0009"></div>',
      [problem({ id: null, title: null, available: false, status: null })],
    ));
    const cards = [...root.querySelectorAll('[data-lesson="problem"]')];
    expect(cards.map((c) => c.getAttribute('data-state'))).toEqual(['unavailable', 'unavailable']);
    expect(cards[0].textContent).toContain('Problem unavailable');
    expect(cards[0].querySelector('a')).toBeNull();
  });

  it('marks a guest card without status', () => {
    const root = mount(prepareLessonHtml('<div data-lesson="problem" data-problem="P0002"></div>', [problem({ status: null, bestScore: null })]));
    const card = root.querySelector('[data-lesson="problem"]')!;
    expect(card.getAttribute('data-state')).toBe('none');
    expect(card.querySelector('[data-part="mark"]')!.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('[data-part="score"]')).toBeNull();
  });

  it('encodes problem paths', () => {
    expect(problemPath('a b')).toBe('/problems/a%20b');
  });
});
