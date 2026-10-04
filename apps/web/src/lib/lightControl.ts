import type { Command } from '@lacs/contracts';

type LightCmd = Extract<Command, { cmd: 'light' }>;
export type LightMode = 'colour' | 'white';

/**
 * The brightness slider's command. The mode comes from what the app last
 * sent, not only from the bulb's report, which lags by a poll and an ack:
 * a colour picked a second ago must not be turned white by the slider.
 */
export function brightnessCommand(mode: LightMode, hue: number, sat: number, bright: number, temp: number): LightCmd {
  return mode === 'colour'
    ? { cmd: 'light', on: true, color: { h: hue, s: sat, v: bright } }
    : { cmd: 'light', on: true, bright, temp };
}

/** The bulb's mode once `command` lands; an on/off-only command keeps the current one. */
export function modeAfter(command: LightCmd, current: LightMode): LightMode {
  if (command.color) return 'colour';
  if (command.bright !== undefined || command.temp !== undefined) return 'white';
  return current;
}

/** Manual or Adaptive, only when an online unit has said which; otherwise unknown. */
export function lightModeOf(online: boolean, auto: boolean | null): 'manual' | 'adaptive' | null {
  if (!online || auto === null) return null;
  return auto ? 'adaptive' : 'manual';
}
