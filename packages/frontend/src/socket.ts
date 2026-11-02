/**
 * Socket.IO client factories and small helpers.
 *
 * Two namespaces are used: `/` for players and `/host` for the host (which
 * authenticates from the session cookie, so `withCredentials` must be set).
 * Every request-style emit uses an ACK and unwraps the `{ ok, data }` envelope
 * the server sends, turning a failure into a rejected promise.
 */

import { io, type Socket } from 'socket.io-client';

import type {
  Ack,
  ClientToServerEvents,
  HostServerEvents,
  PlayerServerEvents,
  ServerToClientEvents,
} from '@zeropeek/shared';

export type PlayerSocket = Socket<PlayerServerEvents, ClientToServerEvents>;
export type HostSocket = Socket<HostServerEvents, ClientToServerEvents>;

/** Connect a player socket (anonymous namespace `/`). */
export function connectPlayer(): PlayerSocket {
  return io('/', { withCredentials: true, transports: ['websocket', 'polling'] });
}

/** Connect a host socket (namespace `/host`, authenticated by cookie). */
export function connectHost(): HostSocket {
  return io('/host', { withCredentials: true, transports: ['websocket', 'polling'] });
}

/** Emit with an ACK and unwrap the envelope. Rejects with the server message. */
export function request<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not respond.')), 10_000);
    (socket as Socket).emit(event, payload, ((reply: { ok: boolean; data?: T; error?: string }) => {
      clearTimeout(timer);
      if (reply?.ok) resolve(reply.data as T);
      else reject(new Error(reply?.error ?? 'The request failed.'));
    }) as Ack<unknown>);
  });
}

/** Wait for one event, with a timeout so a screen never hangs forever. */
export function once<T>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No "${event}" received.`)), timeoutMs);
    (socket as Socket).once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
