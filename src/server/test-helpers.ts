import type { FetchFn } from './http.ts';

export function stubFetch(routes: Record<string, unknown>): FetchFn {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const hit = routes[url.href] ?? routes[url.origin + url.pathname];
    if (hit === undefined) return new Response('not found', { status: 404 });
    if (hit instanceof Response) return hit.clone();
    return typeof hit === 'string' ? new Response(hit) : Response.json(hit);
  }) as FetchFn;
}
