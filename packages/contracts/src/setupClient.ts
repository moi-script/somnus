import {
  SetupLineParser,
  encodeSetupRequest,
  type SetupHello,
  type SetupJoin,
  type SetupNetwork,
  type SetupReply,
  type SetupRequest,
  type SetupResult,
} from './setup.js';

/**
 * Requests and replies over a setup link, without the Bluetooth.
 *
 * The app's roomSetup.ts feeds it notification bytes and the link going
 * away; everything about timing and failure lives here so it can be tested.
 */

export class SetupTimeout extends Error {}

export class SetupRefused extends Error {
  constructor(readonly reason: 'busy' | 'bad_message') {
    super(reason);
  }
}

/** The link dropped while a request was in flight. */
export class SetupLost extends Error {}

/**
 * The phone still holds a pairing the unit has forgotten (its flash was
 * erased), so encrypted writes fail. Only forgetting the unit in Android's
 * Bluetooth settings fixes it.
 */
export class SetupStaleBond extends Error {}

/** How long each step may take before the unit counts as not answering. */
export const SETUP_TIMEOUTS = {
  hello: 5_000,
  scan: 15_000,
  /** From writing a join to the unit's "joining". */
  joinAck: 10_000,
  /** The unit allows 20 s for Wi-Fi. */
  joinWifi: 30_000,
  /** 60 s for a sleeping server, plus up to three 10 s requests in one loop pass. */
  joinServer: 100_000,
} as const;

interface Pending {
  onReply(reply: SetupReply): void;
  fail(err: unknown): void;
}

export class SetupClient {
  private readonly parser = new SetupLineParser();
  // One decoder for the whole link: a character split across two
  // notifications must be rejoined, not turned into two U+FFFD.
  private readonly decoder = new TextDecoder();
  private readonly pending = new Set<Pending>();
  private heardBack = false;
  private gone: Error | null = null;

  constructor(
    private readonly write: (line: string) => Promise<void>,
    /** The phone was already paired before this connection. */
    private readonly wasBonded: boolean,
  ) {}

  /** Bytes from one notification. */
  receive(bytes: Uint8Array): void {
    for (const reply of this.parser.push(this.decoder.decode(bytes, { stream: true }))) {
      this.heardBack = true;
      for (const p of [...this.pending]) p.onReply(reply);
    }
  }

  /** The link dropped: every request in flight fails now, not at its timeout. */
  lost(): void {
    this.gone = this.staleOr(new SetupLost());
    for (const p of [...this.pending]) p.fail(this.gone);
  }

  hello(): Promise<SetupHello> {
    return this.ask({ op: 'hello' }, (r) => (r.op === 'hello' ? r : undefined), SETUP_TIMEOUTS.hello);
  }

  async scan(onNetwork: (network: SetupNetwork) => void): Promise<void> {
    await this.ask(
      { op: 'scan' },
      (r) => (r.op === 'scan_done' ? true : undefined),
      SETUP_TIMEOUTS.scan,
      (r) => {
        if (r.op === 'net') onNetwork(r);
      },
    );
  }

  join(req: Omit<SetupJoin, 'op'>, onStage: (stage: 'join' | 'server') => void): Promise<SetupResult> {
    return this.ask(
      { op: 'join', ...req },
      (r) => (r.op === 'result' ? r : undefined),
      SETUP_TIMEOUTS.joinAck,
      (r) => {
        if (r.op === 'joining') {
          onStage('join');
          return SETUP_TIMEOUTS.joinWifi;
        }
        if (r.op === 'checking') {
          onStage('server');
          return SETUP_TIMEOUTS.joinServer;
        }
        return undefined;
      },
    );
  }

  /** A bonded phone that never heard back is almost always holding a stale bond. */
  private staleOr(err: unknown): Error {
    if (this.wasBonded && !this.heardBack) return new SetupStaleBond();
    return err instanceof Error ? err : new Error(String(err));
  }

  /**
   * Sends one request and resolves with the first reply `pick` accepts.
   * `onOther` sees every reply first, and may return a new timeout for the
   * next stage. The entry goes in before the write, so a fast answer is
   * never missed.
   */
  private ask<T>(
    req: SetupRequest,
    pick: (reply: SetupReply) => T | undefined,
    firstMs: number,
    onOther?: (reply: SetupReply) => number | undefined | void,
  ): Promise<T> {
    if (this.gone) return Promise.reject(this.gone);
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        this.pending.delete(entry);
        settle();
      };
      const arm = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(() => reject(new SetupTimeout())), ms);
      };
      const entry: Pending = {
        onReply: (reply) => {
          if (reply.op === 'error') {
            finish(() => reject(new SetupRefused(reply.reason)));
            return;
          }
          const next = onOther?.(reply);
          if (typeof next === 'number') arm(next);
          const value = pick(reply);
          if (value !== undefined) finish(() => resolve(value));
        },
        fail: (err) => finish(() => reject(err)),
      };
      this.pending.add(entry);
      arm(firstMs);
      this.write(encodeSetupRequest(req)).catch((err) => entry.fail(this.staleOr(err)));
    });
  }
}
