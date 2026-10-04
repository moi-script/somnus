'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command } from '@lacs/contracts';
import { api } from './api';
import type { RoomAck } from './useRoom';

/** The room unit polls every 5 s; well past that and it is probably offline. */
const ANSWER_TIMEOUT_MS = 30_000;

/**
 * Sends a command to the room unit and turns its ack frame into words:
 * "Sent…" until the ack, then "Done." or why not.
 */
export function useLightCommand(deviceId: string | null, lastAck: RoomAck | null) {
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ cmd: string; since: number } | null>(null);

  const send = useCallback(
    async (command: Command) => {
      if (!deviceId) return;
      setMessage('Sent, waiting for the room unit…');
      const since = Date.now();
      pending.current = { cmd: command.cmd, since };
      try {
        await api.queueCommand(deviceId, command);
      } catch (err) {
        pending.current = null;
        setMessage((err as Error).message);
        return;
      }
      setTimeout(() => {
        if (pending.current?.since === since) {
          pending.current = null;
          setMessage('No answer yet. The room unit checks for commands every few seconds, so it may be offline.');
        }
      }, ANSWER_TIMEOUT_MS);
    },
    [deviceId],
  );

  useEffect(() => {
    const waiting = pending.current;
    if (!lastAck || !waiting || lastAck.cmd !== waiting.cmd || lastAck.at < waiting.since) return;
    pending.current = null;
    setMessage(lastAck.ok ? 'Done.' : `The room unit could not do that${lastAck.detail ? `: ${lastAck.detail}` : '.'}`);
  }, [lastAck]);

  return { send, message };
}
