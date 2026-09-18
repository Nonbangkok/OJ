import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Field, Input, Select, Textarea } from '../../../components/ui';

describe('Field', () => {
  it('connects label, hint, error, and required state to its native control', () => {
    render(
      <Field label="Problem ID" hint="Lowercase letters and dashes" error="Already used" required>
        {props => <Input {...props} />}
      </Field>,
    );

    const input = screen.getByLabelText('Problem ID');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Already used');
    expect(screen.getByText('*')).toHaveTextContent('*');
  });

  it('forwards native input attributes, merges consumer classes, and forwards refs', () => {
    const inputRef = createRef<HTMLInputElement>();

    render(
      <Field label="Problem ID">
        {props => <Input {...props} ref={inputRef} className="caller-input" maxLength={32} required />}
      </Field>,
    );

    const input = screen.getByLabelText('Problem ID');
    expect(input).toHaveAttribute('maxlength', '32');
    expect(input).toBeRequired();
    expect(input).toHaveClass('caller-input');
    expect(input.className).not.toBe('caller-input');
    expect(inputRef.current).toBe(input);
  });

  it('forwards native select attributes, merges consumer classes, and forwards refs', () => {
    const selectRef = createRef<HTMLSelectElement>();

    render(
      <Field label="Difficulty">
        {props => (
          <Select {...props} ref={selectRef} className="caller-select" defaultValue="medium" required>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
          </Select>
        )}
      </Field>,
    );

    const select = screen.getByLabelText('Difficulty');
    expect(select).toHaveValue('medium');
    expect(select).toBeRequired();
    expect(select).toHaveClass('caller-select');
    expect(select.className).not.toBe('caller-select');
    expect(selectRef.current).toBe(select);
  });

  it('forwards native textarea attributes, merges consumer classes, and forwards refs', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();

    render(
      <Field label="Notes">
        {props => <Textarea {...props} ref={textareaRef} className="caller-textarea" rows={4} required />}
      </Field>,
    );

    const textarea = screen.getByLabelText('Notes');
    expect(textarea).toHaveAttribute('rows', '4');
    expect(textarea).toBeRequired();
    expect(textarea).toHaveClass('caller-textarea');
    expect(textarea.className).not.toBe('caller-textarea');
    expect(textareaRef.current).toBe(textarea);
  });
});
