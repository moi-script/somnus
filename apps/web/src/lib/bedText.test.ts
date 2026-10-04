import { describe, expect, it } from 'vitest';
import { bedExitLabel, presenceLine } from './bedText';

const MIN = 60_000;

describe('presenceLine', () => {
  it('says nothing about time in bed until the window has loaded', () => {
    expect(presenceLine(true, { presentMs: 0, exits: 0 }, '1 h')).toBe('Loading the last 1 h…');
  });

  it('counts time in bed and trips out', () => {
    expect(presenceLine(false, { presentMs: 42 * MIN, exits: 3 }, '1 h')).toBe('In bed 42 min of the last 1 h · left 3 times');
    expect(presenceLine(false, { presentMs: 42 * MIN, exits: 1 }, '1 h')).toBe('In bed 42 min of the last 1 h · left 1 time');
    expect(presenceLine(false, { presentMs: 60 * MIN, exits: 0 }, '1 h')).toBe('In bed 1 h of the last 1 h');
  });
});

describe('bedExitLabel', () => {
  const tonight = 1_000_000;

  it('is unknown while loading', () => {
    expect(bedExitLabel(true, null, tonight)).toBe('--');
  });

  it('ignores exits before tonight', () => {
    expect(bedExitLabel(false, tonight - 1, tonight)).toBe('Not detected');
  });

  it('shows tonight\'s latest exit', () => {
    expect(bedExitLabel(false, tonight + 5, tonight)).toMatch(/^Left \d{2}:\d{2}$/);
  });
});
