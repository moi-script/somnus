import { describe, expect, it } from 'vitest';
import { signupProblem } from './signup';

describe('signupProblem', () => {
  it('accepts matching passwords of 8 or more characters', () => {
    expect(signupProblem('correct-horse', 'correct-horse')).toBeNull();
  });

  it('asks for at least 8 characters', () => {
    expect(signupProblem('short', 'short')).toBe('Use at least 8 characters.');
  });

  it('catches a typo in the second password', () => {
    expect(signupProblem('correct-horse', 'correct-hrose')).toBe('The two passwords do not match.');
  });
});
