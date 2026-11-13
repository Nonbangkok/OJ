import { fireEvent, render } from '@testing-library/react';
import CodeEditor from './CodeEditor';

const code = 'int main() {\n  return 0;\n}\n';

describe('CodeEditor while disabled (e.g. a job is running)', () => {
  it('stays scrollable and selectable: read-only, not disabled', () => {
    render(<CodeEditor label="Solution" value={code} disabled onChange={jest.fn()} />);
    const textarea = document.getElementById('editor-Solution') as HTMLTextAreaElement;

    // Gecko browsers block all interaction with a disabled textarea,
    // including scrolling its contents.
    expect(textarea).not.toBeDisabled();
    expect(textarea).toHaveAttribute('readonly');
  });

  it('never reports an edit, even for keys the editor library handles itself', () => {
    const onChange = jest.fn();
    render(<CodeEditor label="Solution" value={code} disabled onChange={onChange} />);
    const textarea = document.getElementById('editor-Solution') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(code.length, code.length);

    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Tab' });
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true });
    fireEvent.change(textarea, { target: { value: code + 'x' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('is editable again when enabled', () => {
    const onChange = jest.fn();
    render(<CodeEditor label="Solution" value={code} disabled={false} onChange={onChange} />);
    const textarea = document.getElementById('editor-Solution') as HTMLTextAreaElement;

    expect(textarea).not.toHaveAttribute('readonly');
    fireEvent.change(textarea, { target: { value: code + 'x' } });
    expect(onChange).toHaveBeenCalledWith(code + 'x');
  });
});
