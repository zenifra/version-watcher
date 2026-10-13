export class Unauthorized extends Error {}

export type OnAuthError = (e: unknown) => void;

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) throw new Unauthorized('unauthorized');
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export const isHttpUrl = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);
