import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SetupClient,
  SetupLost,
  SetupRefused,
  SetupStaleBond,
  SetupTimeout,
  type SetupNetwork,
} from '../src/index.js';

const bytes = (s: string) => new TextEncoder().encode(s);

/** A client whose writes succeed and are recorded. */
function client(wasBonded = false) {
  const written: string[] = [];
  const c = new SetupClient(async (line) => {
    written.push(line);
  }, wasBonded);
  return { c, written };
}

const JOIN = { ssid: 'Home', password: 'password1', server: 'https://x.test', key: 'k' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SetupClient', () => {
  it('answers hello and writes one line', async () => {
    const { c, written } = client();
    const hello = c.hello();
    c.receive(bytes('{"op":"hello","id":"room-7c1a02","fw":"0.4.0","wifi":null}\n'));
    await expect(hello).resolves.toMatchObject({ id: 'room-7c1a02' });
    expect(written).toEqual(['{"op":"hello"}\n']);
  });

  it('keeps a network name whose emoji is split across notifications', async () => {
    const { c } = client();
    const seen: SetupNetwork[] = [];
    const scan = c.scan((n) => seen.push(n));
    const line = bytes('{"op":"net","ssid":"Casa 😴","rssi":-50,"secure":true}\n{"op":"scan_done"}\n');
    const cut = line.indexOf(0xf0) + 2; // in the middle of the 4-byte emoji
    c.receive(line.slice(0, cut));
    c.receive(line.slice(cut));
    await scan;
    expect(seen.map((n) => n.ssid)).toEqual(['Casa 😴']);
  });

  it('fails a request in flight as soon as the link drops, not at its timeout', async () => {
    const { c } = client();
    const join = c.join(JOIN, () => {});
    c.receive(bytes('{"op":"hello","id":"room-7c1a02","fw":"0.4.0","wifi":null}\n'));
    c.lost();
    await expect(join).rejects.toBeInstanceOf(SetupLost);
  });

  it('refuses new requests after the link dropped', async () => {
    const { c } = client();
    c.lost();
    await expect(c.hello()).rejects.toBeInstanceOf(SetupLost);
  });

  it('blames a stale bond when the first write fails on a bonded phone', async () => {
    const c = new SetupClient(async () => {
      throw new Error('Writing characteristic failed.');
    }, true);
    await expect(c.hello()).rejects.toBeInstanceOf(SetupStaleBond);
  });

  it('passes a write failure through when the phone was not bonded before', async () => {
    const c = new SetupClient(async () => {
      throw new Error('Writing characteristic failed.');
    }, false);
    await expect(c.hello()).rejects.toThrow('Writing characteristic failed.');
  });

  it('blames a stale bond when a bonded phone is dropped before any reply', async () => {
    const { c } = client(true);
    const hello = c.hello();
    c.lost();
    await expect(hello).rejects.toBeInstanceOf(SetupStaleBond);
  });

  it('calls a drop after a reply a plain lost link', async () => {
    const { c } = client(true);
    const hello = c.hello();
    c.receive(bytes('{"op":"hello","id":"room-7c1a02","fw":"0.4.0","wifi":null}\n'));
    await hello;
    const scan = c.scan(() => {});
    c.lost();
    await expect(scan).rejects.toBeInstanceOf(SetupLost);
  });

  it('times out a join the unit never acknowledges', async () => {
    const { c } = client();
    const join = c.join(JOIN, () => {});
    const caught = expect(join).rejects.toBeInstanceOf(SetupTimeout);
    await vi.advanceTimersByTimeAsync(10_001);
    await caught;
  });

  it('gives each join stage its own time, so a slow server is waited for', async () => {
    const { c } = client();
    const stages: string[] = [];
    const join = c.join(JOIN, (s) => stages.push(s));
    await vi.advanceTimersByTimeAsync(5_000);
    c.receive(bytes('{"op":"joining"}\n'));
    await vi.advanceTimersByTimeAsync(25_000);
    c.receive(bytes('{"op":"checking"}\n'));
    await vi.advanceTimersByTimeAsync(95_000); // 125 s in total
    c.receive(bytes('{"op":"result","wifi":"ok","server":"unreachable"}\n'));
    await expect(join).resolves.toMatchObject({ server: 'unreachable' });
    expect(stages).toEqual(['join', 'server']);
  });

  it('turns an error reply into SetupRefused', async () => {
    const { c } = client();
    const scan = c.scan(() => {});
    c.receive(bytes('{"op":"error","reason":"busy"}\n'));
    await expect(scan).rejects.toMatchObject({ reason: 'busy' });
    await expect(scan).rejects.toBeInstanceOf(SetupRefused);
  });
});
