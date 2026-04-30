import { describe, it, expect } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('returns message from Error object', () => {
    const error = new Error('Something went wrong');
    expect(errorMessage(error)).toBe('Something went wrong');
  });

  it('returns string if error is a string', () => {
    expect(errorMessage('String error')).toBe('String error');
  });

  it('returns fallback for unknown objects', () => {
    expect(errorMessage({ code: 500 })).toBe('An unknown error occurred');
  });

  it('returns fallback for null/undefined', () => {
    expect(errorMessage(null)).toBe('An unknown error occurred');
    expect(errorMessage(undefined)).toBe('An unknown error occurred');
  });
});
