import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LessonContent from '../../../features/learn/LessonContent';
import type { LearnLessonProblem } from '../../../types';

const problems: LearnLessonProblem[] = [{
  position: 1, role: 'practice', available: true, id: 'P0150', title: 'Subarray Sum K', difficulty: 1300,
  problemType: 'standard', status: 'not_tried', bestScore: null, caseStatuses: [],
}];

const html = [
  '<h2 id="section-1">ไอเดีย</h2>',
  '<p>ลองดูรูปนี้ <img src="{{ASSET_BASE}}/figure-1.png" alt="รูป"></p>',
  '<div data-lesson="code-tabs"><pre><code class="language-cpp">int a;</code></pre><pre><code class="language-python">a = 0</code></pre></div>',
  '<div data-lesson="problem" data-problem="P0150"></div>',
].join('');

const renderContent = () => render(
  <MemoryRouter initialEntries={['/learn/foundations/prefix-sums']}>
    <Routes>
      <Route path="/learn/:track/:lesson" element={<LessonContent lessonSlug="prefix-sums" html={html} problems={problems} />} />
      <Route path="/problems/:id" element={<p>problem page</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('LessonContent', () => {
  it('renders the lesson with resolved image URLs', () => {
    renderContent();
    expect(screen.getByRole('heading', { name: 'ไอเดีย' })).toHaveAttribute('id', 'section-1');
    expect(screen.getByAltText('รูป').getAttribute('src')).toMatch(/\/learn\/lessons\/prefix-sums\/assets\/figure-1\.png$/);
  });

  it('switches code tabs by click and arrow keys', () => {
    renderContent();
    const python = screen.getByRole('tab', { name: 'Python' });
    fireEvent.click(python);
    expect(python).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(python, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'C++' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'C++' })).toHaveFocus();
  });

  it('copies the visible code', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderContent();
    const copy = screen.getByRole('button', { name: 'Copy' });
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith('int a;');
    expect(copy).toHaveTextContent('Copied');
  });

  it('opens a problem card link inside the app', () => {
    renderContent();
    fireEvent.click(screen.getByRole('link', { name: 'Open problem' }));
    expect(screen.getByText('problem page')).toBeInTheDocument();
  });
});
