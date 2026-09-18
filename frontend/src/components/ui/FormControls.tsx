import { forwardRef } from 'react';
import type React from 'react';
import styles from './Field.module.css';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

function mergeClassName(className?: string) {
  return [styles.control, className].filter(Boolean).join(' ');
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input {...props} ref={ref} className={mergeClassName(className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  return <select {...props} ref={ref} className={mergeClassName(className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return <textarea {...props} ref={ref} className={mergeClassName(className)} />;
});
