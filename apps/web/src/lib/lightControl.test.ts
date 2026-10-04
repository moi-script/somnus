import { describe, expect, it } from 'vitest';
import { brightnessCommand, lightModeOf, modeAfter } from './lightControl';

describe('brightnessCommand', () => {
  it('keeps a colour the user just chose', () => {
    expect(brightnessCommand('colour', 200, 80, 40, 20)).toEqual({ cmd: 'light', on: true, color: { h: 200, s: 80, v: 40 } });
  });

  it('dims white light as white', () => {
    expect(brightnessCommand('white', 200, 80, 40, 20)).toEqual({ cmd: 'light', on: true, bright: 40, temp: 20 });
  });
});

describe('modeAfter', () => {
  it('follows the command just sent, before the bulb reports back', () => {
    expect(modeAfter({ cmd: 'light', on: true, color: { h: 0, s: 100, v: 15 } }, 'white')).toBe('colour');
    expect(modeAfter({ cmd: 'light', on: true, bright: 70, temp: 40 }, 'colour')).toBe('white');
    expect(modeAfter({ cmd: 'light', on: false }, 'colour')).toBe('colour');
  });
});

describe('lightModeOf', () => {
  it('only claims a mode the unit has reported while online', () => {
    expect(lightModeOf(true, true)).toBe('adaptive');
    expect(lightModeOf(true, false)).toBe('manual');
    expect(lightModeOf(true, null)).toBeNull();
    expect(lightModeOf(false, true)).toBeNull();
  });
});
