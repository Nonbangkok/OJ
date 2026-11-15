import { fireEvent, render, screen } from '@testing-library/react';
import { FileDrop } from '../../../components/ui';

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name);
const drop = (target: HTMLElement, files: File[]) => fireEvent.drop(target, { dataTransfer: { files, types: ['Files'] } });

describe('FileDrop', () => {
  it('passes accepted files on', () => {
    const onFiles = jest.fn();
    render(<FileDrop label="Testcase ZIP" accept={['.zip']} onFiles={onFiles} />);
    drop(screen.getByRole('button', { name: /testcase zip/i }), [file('cases.zip')]);
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'cases.zip' })]);
  });

  it('rejects a wrong type with a visible reason', () => {
    const onFiles = jest.fn();
    render(<FileDrop label="Testcase ZIP" accept={['.zip']} onFiles={onFiles} />);
    drop(screen.getByRole('button', { name: /testcase zip/i }), [file('virus.exe')]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('virus.exe is not a .zip file');
  });

  it('rejects several files when one is allowed, and oversize files', () => {
    const onFiles = jest.fn();
    render(<FileDrop label="Header" accept={['.h']} maxBytes={5} onFiles={onFiles} />);
    const zone = screen.getByRole('button', { name: /header/i });
    drop(zone, [file('a.h', 1), file('b.h', 1)]);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose one file');
    drop(zone, [file('big.h', 50)]);
    expect(screen.getByRole('alert')).toHaveTextContent('big.h is larger than 5 B');
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('opens the file picker from the keyboard', () => {
    render(<FileDrop label="Header" onFiles={jest.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = jest.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByRole('button', { name: /header/i }), { key: 'Enter' });
    expect(click).toHaveBeenCalled();
  });
});
