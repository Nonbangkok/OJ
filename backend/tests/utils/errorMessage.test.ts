import { getErrorMessage } from '../../utils/errorMessage';

describe('getErrorMessage', () => {
  it('should return message from Error instance', () => {
    const message = getErrorMessage(new Error('boom'));
    expect(message).toBe('boom');
  });

  it('should return fallback when error is not an Error', () => {
    const message = getErrorMessage({ any: 'value' }, 'fallback');
    expect(message).toBe('fallback');
  });

  it('should return default fallback when not provided', () => {
    const message = getErrorMessage(null);
    expect(message).toBe('Unknown error');
  });
});
