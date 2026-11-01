import { useEffect, useRef } from 'react';

/** Every Event the server writes (src/chat/loop.ts, driver.ts, runs.ts). A named Event fires only its own listener, never `onmessage`. */
export const EVENT_TYPES = [
  'turn.started',
  'turn.text',
  'turn.tool',
  'turn.awaiting',
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
  'quote.approved',
  'quote.repriced',
  'job.planned',
  'run.started',
  'run.step',
  'run.done',
  'run.failed',
  'run.stopped',
];

/** A backfill arrives as a burst; one refresh answers all of it. */
const SETTLE_MS = 150;

/**
 * Hears a Thread's Events as they happen, so the page need not wait for its next
 * poll. An Event only says "look again": what it carries is never read, so no URL
 * or model text can come in this way. Polling is the floor: on any error the
 * stream closes for good and `chat.thread` carries the page.
 */
export function useChatEvents(threadId: string | null, lastSeq: number, onEvent: () => void) {
  const since = useRef(lastSeq);
  since.current = lastSeq;
  const hear = useRef(onEvent);
  hear.current = onEvent;

  useEffect(() => {
    if (!threadId || typeof EventSource === 'undefined') return;
    const query = new URLSearchParams({ thread: threadId, since: String(since.current) });
    const source = new EventSource(`/api/chat/events?${query}`);
    let settling: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      if (settling !== undefined) return;
      settling = setTimeout(() => {
        settling = undefined;
        hear.current();
      }, SETTLE_MS);
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, heard);
    source.onerror = () => source.close();
    return () => {
      clearTimeout(settling);
      source.close();
    };
  }, [threadId]);
}
