import { EventEmitter } from 'node:events';
import type { Frame } from '@lacs/contracts';

/**
 * In-process fan-out from ingest to any open SSE stream.
 *
 * Deliberately not durable: a browser that was not watching when a frame
 * arrived reads it back from Mongo instead. That keeps live delivery cheap
 * and means a slow dashboard can never back-pressure ingest.
 *
 * This is per-process. Running the API on more than one instance needs a
 * Redis pub/sub in place of this file - nothing else would change.
 */
class FrameBus extends EventEmitter {
  publish(deviceId: string, frame: Frame): void {
    this.emit(deviceId, frame);
  }

  subscribe(deviceId: string, listener: (frame: Frame) => void): () => void {
    this.on(deviceId, listener);
    return () => this.off(deviceId, listener);
  }
}

export const frameBus = new FrameBus();
// One listener per open browser tab; the default cap of 10 is far too low.
frameBus.setMaxListeners(1000);
