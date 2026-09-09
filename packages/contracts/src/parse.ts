import { frameSchema, type Frame } from './frames.js';

export type ParseResult =
  | { ok: true; frame: Frame }
  /** A human-readable [..] line, or blank. Expected, not an error. */
  | { ok: false; reason: 'not-a-frame'; line: string }
  | { ok: false; reason: 'bad-json'; line: string }
  | { ok: false; reason: 'schema'; line: string; issues: string[] };

/**
 * Classify one line from the device.
 *
 * The firmware deliberately interleaves two streams on the same link: human
 * status text starting with '[' and JSON frames starting with '{'. Anything
 * that is not a frame is reported as 'not-a-frame' rather than thrown, so a
 * caller can log it and move on.
 */
export function parseFrameLine(line: string): ParseResult {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed[0] !== '{') {
    return { ok: false, reason: 'not-a-frame', line: trimmed };
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: 'bad-json', line: trimmed };
  }

  const parsed = frameSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'schema',
      line: trimmed,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  return { ok: true, frame: parsed.data };
}

/**
 * Accumulates arbitrary chunks into whole lines.
 *
 * Both transports need this. A serial read returns whatever bytes happened to
 * arrive, and a BLE notification can split a frame across packets, so neither
 * gives you a guaranteed-complete line. Feeding raw chunks to JSON.parse is
 * the single most common way this kind of bridge breaks.
 */
export class FrameLineParser {
  private buffer = '';

  constructor(private readonly maxBufferBytes = 8192) {}

  /** Push a chunk, get back every complete line it finished. */
  push(chunk: string): ParseResult[] {
    this.buffer += chunk;

    // A frame that never terminates would grow this forever - drop it rather
    // than leak, since a truncated frame is unrecoverable anyway.
    if (this.buffer.length > this.maxBufferBytes) {
      this.buffer = this.buffer.slice(-this.maxBufferBytes);
    }

    const results: ParseResult[] = [];
    let newlineAt: number;
    while ((newlineAt = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      const result = parseFrameLine(line);
      // Silently skip blank lines; report everything else so callers can log.
      if (result.ok || result.line.length > 0) results.push(result);
    }
    return results;
  }

  /** Frames only, for callers that do not care about the human stream. */
  pushFrames(chunk: string): Frame[] {
    return this.push(chunk).flatMap((r) => (r.ok ? [r.frame] : []));
  }

  reset(): void {
    this.buffer = '';
  }

  get pending(): string {
    return this.buffer;
  }
}
