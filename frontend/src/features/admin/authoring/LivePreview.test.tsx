import { fireEvent, render, screen } from '@testing-library/react';
import LivePreview from './LivePreview';

test('keeps the iframe document stable while updating only the statement body', () => {
  const shell = '<html><article id="statement" class="statement"></article></html>';
  const article = { innerHTML: '' };
  const doc = {
    body: { scrollHeight: 640, offsetHeight: 640 },
    documentElement: { scrollHeight: 640, offsetHeight: 640 },
    fonts: { ready: Promise.resolve() },
    getElementById: jest.fn(() => article),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  } as unknown as Document;
  const { rerender } = render(<LivePreview shell={shell} statement="<p>first</p>" zoomScale={1} />);
  const frame = screen.getByTitle('Live statement preview');
  Object.defineProperty(frame, 'contentDocument', { configurable: true, value: doc });
  fireEvent.load(frame);

  expect(frame).toHaveAttribute('srcdoc', shell);
  expect(article.innerHTML).toBe('<p>first</p>');

  rerender(<LivePreview shell={shell} statement="<p>second</p>" zoomScale={1} />);

  expect(frame).toHaveAttribute('srcdoc', shell);
  expect(article.innerHTML).toBe('<p>second</p>');
});
