import { describe, expect, it } from 'vitest';
import {
  MAX_NETWORKS,
  SetupLineParser,
  describeResult,
  encodeSetupRequest,
  joinProblem,
  mergeNetworks,
  signalBars,
  type SetupNetwork,
} from '../src/index.js';

const JOIN = {
  op: 'join' as const,
  ssid: 'PLDT-Home',
  password: 'correct horse',
  server: 'https://somnus-api.onrender.com/',
  key: 'room-7c1a02.abc',
};

describe('encodeSetupRequest', () => {
  it('writes one line and trims the server address', () => {
    const line = encodeSetupRequest(JOIN);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2);
    expect(JSON.parse(line).server).toBe('https://somnus-api.onrender.com');
  });

  it('allows an open network', () => {
    expect(() => encodeSetupRequest({ ...JOIN, password: '' })).not.toThrow();
  });

  it.each([
    ['empty ssid', { ...JOIN, ssid: '' }],
    ['33-byte ssid', { ...JOIN, ssid: 'x'.repeat(33) }],
    ['short password', { ...JOIN, password: 'short' }],
    ['64-char password', { ...JOIN, password: 'p'.repeat(64) }],
    ['server without scheme', { ...JOIN, server: 'somnus-api.onrender.com' }],
    ['empty key', { ...JOIN, key: '' }],
  ])('refuses %s', (_, req) => {
    expect(() => encodeSetupRequest(req)).toThrow();
  });
});

describe('joinProblem', () => {
  it('measures network names in bytes, not characters', () => {
    // 8 emoji = 32 bytes in UTF-8: allowed. 9 = 36 bytes: refused.
    expect(joinProblem('😴'.repeat(8), 'password1')).toBeNull();
    expect(joinProblem('😴'.repeat(9), 'password1')).toBe('Network names are at most 32 bytes.');
  });

  it('explains a password of the wrong length', () => {
    expect(joinProblem('Home', 'short')).toBe('Wi-Fi passwords are 8 to 63 characters.');
    expect(joinProblem('Home', '')).toBeNull();
  });

  it('asks for a name when there is none', () => {
    expect(joinProblem('', 'password1')).toBe('Enter the network name.');
  });
});

describe('SetupLineParser', () => {
  it('rejoins a reply split across notifications', () => {
    const parser = new SetupLineParser();
    expect(parser.push('{"op":"hello","id":"room-7c1a02",')).toEqual([]);
    expect(parser.push('"fw":"0.4.0","wifi":null}\n')).toEqual([
      { op: 'hello', id: 'room-7c1a02', fw: '0.4.0', wifi: null },
    ]);
  });

  it('returns every reply in one chunk, in order', () => {
    const parser = new SetupLineParser();
    const replies = parser.push(
      '{"op":"net","ssid":"A","rssi":-50,"secure":true}\n{"op":"scan_done"}\n',
    );
    expect(replies.map((r) => r.op)).toEqual(['net', 'scan_done']);
  });

  it('drops blank, broken and unknown lines', () => {
    const parser = new SetupLineParser();
    expect(parser.push('\n{oops\n{"op":"reboot"}\n{"op":"joining"}\n')).toEqual([{ op: 'joining' }]);
  });

  it('accepts a result with no server check', () => {
    const parser = new SetupLineParser();
    expect(parser.push('{"op":"result","wifi":"not_found","server":null}\n')).toEqual([
      { op: 'result', wifi: 'not_found', server: null },
    ]);
  });
});

describe('mergeNetworks', () => {
  const net = (ssid: string, rssi: number, secure = true): SetupNetwork => ({ ssid, rssi, secure });

  it('keeps one row per name with the strongest signal', () => {
    let list = mergeNetworks([], net('Home', -80));
    list = mergeNetworks(list, net('Home', -60));
    list = mergeNetworks(list, net('Home', -70));
    expect(list).toEqual([net('Home', -60)]);
  });

  it('sorts strongest first', () => {
    let list: SetupNetwork[] = [];
    for (const n of [net('B', -70), net('A', -40), net('C', -90)]) list = mergeNetworks(list, n);
    expect(list.map((n) => n.ssid)).toEqual(['A', 'B', 'C']);
  });

  it('drops hidden networks', () => {
    expect(mergeNetworks([], net('', -40))).toEqual([]);
  });

  it(`keeps at most ${MAX_NETWORKS}`, () => {
    let list: SetupNetwork[] = [];
    for (let i = 0; i < 30; i++) list = mergeNetworks(list, net(`N${i}`, -40 - i));
    expect(list).toHaveLength(MAX_NETWORKS);
    expect(list.at(-1)!.ssid).toBe('N19');
  });

  it('strips the op field a net reply carries', () => {
    const reply = { op: 'net', ssid: 'Home', rssi: -50, secure: false } as SetupNetwork;
    expect(mergeNetworks([], reply)).toEqual([net('Home', -50, false)]);
  });
});

describe('signalBars', () => {
  it.each([
    [-40, 4],
    [-55, 4],
    [-60, 3],
    [-70, 2],
    [-90, 1],
  ])('%i dBm is %i bars', (rssi, bars) => {
    expect(signalBars(rssi)).toBe(bars);
  });
});

describe('describeResult', () => {
  it('is online only when both Wi-Fi and the server are ok', () => {
    expect(describeResult({ wifi: 'ok', server: 'ok' })).toMatchObject({ ok: true, backTo: null });
  });

  it.each([
    ['wrong_password', null, 'Wrong password', 'password'],
    ['not_found', null, 'Network not found', 'wifi'],
    ['timeout', null, 'The network did not answer', 'password'],
    ['ok', 'unauthorized', 'Server rejected the key', 'retry'],
    ['ok', 'unreachable', 'Server did not answer', 'retry'],
    ['ok', null, 'Server did not answer', 'retry'],
  ] as const)('wifi=%s server=%s -> %s', (wifi, server, title, backTo) => {
    expect(describeResult({ wifi, server })).toMatchObject({ ok: false, title, backTo });
  });
});
