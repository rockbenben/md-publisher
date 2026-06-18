import { useEffect, useRef, useState } from 'react';

export interface SSEHandlers {
  log?: (d: { text: string; level?: 'error' }) => void;
  status?: (d: { publishing: boolean }) => void;
  progress?: (d: { articleIndex: number; articleCount: number; title: string }) => void;
  platform?: (d: { platform: string; status: string; name?: string }) => void;
  done?: (d: { results: { success: boolean }[] }) => void;
  cancelled?: () => void;
  'login-check'?: (d: { status: 'start' | 'done' }) => void;
  'login-status'?: (d: { id: string; loggedIn: boolean; username?: string }) => void;
  'app-error'?: (d: { message: string }) => void;
}

const EVENTS: (keyof SSEHandlers)[] = [
  'log',
  'status',
  'progress',
  'platform',
  'done',
  'cancelled',
  'login-check',
  'login-status',
  'app-error',
];

function safeParse(e: MessageEvent): unknown {
  try {
    return JSON.parse(e.data);
  } catch {
    return null;
  }
}

/**
 * Connects to /api/events, dispatches typed events to handlers, and
 * reconnects with exponential backoff (1s → 30s) — mirrors the original
 * connectSSE() behavior. Handlers are read through a ref so the EventSource
 * is created exactly once.
 */
export function useSSE(handlers: SSEHandlers): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry = 1000;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');

      es.addEventListener('connected', () => {
        setConnected(true);
        retry = 1000;
      });

      for (const name of EVENTS) {
        es.addEventListener(name, (e) => {
          const data = name === 'cancelled' ? {} : safeParse(e as MessageEvent);
          if (data === null) return;
          const fn = handlersRef.current[name] as ((d: unknown) => void) | undefined;
          fn?.(data);
        });
      }

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (closed) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);

  return { connected };
}
