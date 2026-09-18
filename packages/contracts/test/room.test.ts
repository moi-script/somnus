import { describe, expect, it } from 'vitest';
import {
  claimDeviceSchema,
  commandFitsDevice,
  deviceKindOf,
  lightCommandProblem,
  parseFrameLine,
  queueCommandSchema,
} from '../src/index.js';

/** Shaped exactly as the room unit's ArduinoJson serialiser writes them. */
const PRESENCE = '{"v":2,"t":"presence","id":"room-7c1a02","seq":88,"ms":912345,"present":true}';

const LIGHT_WHITE =
  '{"v":2,"t":"light","id":"room-7c1a02","seq":89,"ms":912400,' +
  '"on":true,"mode":"white","bright":20,"temp":10,"color":null,"source":"auto"}';

const LIGHT_COLOUR =
  '{"v":2,"t":"light","id":"room-7c1a02","seq":90,"ms":913000,' +
  '"on":true,"mode":"colour","bright":null,"temp":null,"color":{"h":20,"s":90,"v":30},"source":"app"}';

const ROOM_STATUS =
  '{"v":2,"t":"status","id":"room-7c1a02","seq":1,"ms":900,"fw":"0.1.0",' +
  '"transport":"wifi","online":2,"total":2,' +
  '"sensors":{"sen0395":true,"bulb":true},"config":{"auto":true,"offDelayMs":30000}}';

describe('room frames', () => {
  it('accepts presence, both light modes and a room status', () => {
    for (const line of [PRESENCE, LIGHT_WHITE, LIGHT_COLOUR, ROOM_STATUS]) {
      const r = parseFrameLine(line);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  });

  it('narrows light frames to their state', () => {
    const r = parseFrameLine(LIGHT_COLOUR);
    if (!r.ok || r.frame.t !== 'light') throw new Error('did not narrow to light');
    expect(r.frame.color).toEqual({ h: 20, s: 90, v: 30 });
    expect(r.frame.source).toBe('app');
  });

  it('rejects an unknown light source', () => {
    const r = parseFrameLine(LIGHT_WHITE.replace('"auto"', '"magic"'));
    expect(r.ok).toBe(false);
  });
});

describe('device kinds', () => {
  it('derives the kind from the id prefix', () => {
    expect(deviceKindOf('room-7c1a02')).toBe('room');
    expect(deviceKindOf('lacs-7a3f21')).toBe('band');
  });

  it('lets a room unit be claimed, but only with a firmware-shaped id', () => {
    expect(claimDeviceSchema.safeParse({ deviceId: 'room-7c1a02' }).success).toBe(true);
    expect(claimDeviceSchema.safeParse({ deviceId: 'rooms-7c1a02' }).success).toBe(false);
    expect(claimDeviceSchema.safeParse({ deviceId: 'room-7C1A02' }).success).toBe(false);
  });
});

describe('room commands', () => {
  it('only sends each device the commands it understands', () => {
    expect(commandFitsDevice({ cmd: 'buzz' }, 'room')).toBe(false);
    expect(commandFitsDevice({ cmd: 'status' }, 'room')).toBe(true);
    expect(commandFitsDevice({ cmd: 'light', on: true }, 'room')).toBe(true);
    expect(commandFitsDevice({ cmd: 'light', on: true }, 'band')).toBe(false);
    expect(commandFitsDevice({ cmd: 'auto', on: false }, 'band')).toBe(false);
    expect(commandFitsDevice({ cmd: 'buzz' }, 'band')).toBe(true);
  });

  it('needs a light command to actually say something', () => {
    expect(lightCommandProblem({ cmd: 'light' })).not.toBeNull();
    expect(lightCommandProblem({ cmd: 'light', on: false })).toBeNull();
    expect(lightCommandProblem({ cmd: 'light', bright: 30, temp: 0 })).toBeNull();
  });

  it('refuses a colour mixed with white settings', () => {
    const problem = lightCommandProblem({
      cmd: 'light',
      temp: 10,
      color: { h: 20, s: 90, v: 30 },
    });
    expect(problem).not.toBeNull();
    expect(
      queueCommandSchema.safeParse({
        command: { cmd: 'light', temp: 10, color: { h: 20, s: 90, v: 30 } },
      }).success,
    ).toBe(false);
    expect(
      queueCommandSchema.safeParse({ command: { cmd: 'light', color: { h: 20, s: 90, v: 30 } } })
        .success,
    ).toBe(true);
  });
});
