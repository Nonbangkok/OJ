import type { CSSProperties } from 'react';

export interface AsyncState {
  loading: boolean;
  error: string;
}

export interface AuthFormValues {
  username: string;
  password: string;
}

export interface SliderStyle extends CSSProperties {
  opacity: number;
  height?: number;
  top?: number;
}
