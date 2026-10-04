import { describe, expect, it } from 'vitest';
import { forwardTarget } from './forward';

describe('forwardTarget', () => {
  it('keeps the query string', () => {
    expect(forwardTarget('/more/history/', '?id=lacs-7a3f21')).toBe('/more/history/?id=lacs-7a3f21');
  });

  it('works without one', () => {
    expect(forwardTarget('/home/', '')).toBe('/home/');
  });
});
