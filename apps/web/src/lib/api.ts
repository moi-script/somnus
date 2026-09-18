import type {
  AuthResponse,
  Command,
  Device,
  LightSource,
  LightState,
  NightSummary,
  QueuedCommand,
  Reading,
  StoredEvent,
} from '@lacs/contracts';

/**
 * Baked in at build time. For an APK this must be a LAN IP or public URL -
 * localhost on a phone is the phone itself, not your laptop.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = `${API_URL}/api/v1`;

const TOKEN_KEY = 'lacs.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;

  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    // Distinguish "server unreachable" from "server said no". On a phone this
    // is the common case and the UI should say so plainly.
    throw new ApiError(0, `Cannot reach the server at ${API_URL}`);
  }

  if (res.status === 401) {
    setToken(null);
    throw new ApiError(401, 'Your session expired. Sign in again.');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
      issues?: string[];
    };
    const message = body.issues?.join(', ') ?? body.detail ?? body.error ?? res.statusText;
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ id: string; email: string }>('/auth/me'),

  devices: () => request<Device[]>('/devices'),

  claim: (deviceId: string, name?: string) =>
    request<{ device: Device; ingestToken: string }>('/devices/claim', {
      method: 'POST',
      body: JSON.stringify({ deviceId, name }),
    }),

  device: (deviceId: string) => request<Device>(`/devices/${deviceId}`),

  latest: (deviceId: string) => request<Reading>(`/devices/${deviceId}/latest`),

  readings: (deviceId: string, limit = 200) =>
    request<Reading[]>(`/devices/${deviceId}/readings?limit=${limit}`),

  events: (deviceId: string, limit = 50) =>
    request<StoredEvent[]>(`/devices/${deviceId}/events?limit=${limit}`),

  queueCommand: (deviceId: string, command: Command) =>
    request<QueuedCommand>(`/devices/${deviceId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),

  commandHistory: (deviceId: string) =>
    request<QueuedCommand[]>(`/devices/${deviceId}/commands`),

  roomLatest: (deviceId: string) => request<RoomLatest>(`/devices/${deviceId}/room/latest`),

  night: (deviceId: string, date: string) =>
    request<NightSummary>(`/devices/${deviceId}/nights/${date}?tz=${tz()}`),

  nights: (deviceId: string, limit = 14) =>
    request<NightSummary[]>(`/devices/${deviceId}/nights?limit=${limit}&tz=${tz()}`),
};

/** Nights run 18:00-14:00 on this device's clock, so the server is told which clock. */
function tz(): number {
  return new Date().getTimezoneOffset();
}

export interface RoomLatest {
  presence: { present: boolean; at: string } | null;
  light: { state: LightState; source: LightSource; at: string } | null;
}

/** EventSource cannot set headers, so the token rides in the query string. */
export function streamUrl(deviceId: string): string {
  return `${BASE}/stream/${deviceId}?token=${encodeURIComponent(getToken() ?? '')}`;
}
