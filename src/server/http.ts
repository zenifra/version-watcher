export type FetchFn = typeof fetch;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class RateLimitError extends Error {}

async function request(f: FetchFn, url: string, headers: Record<string, string>): Promise<Response> {
  const res = await f(url, { headers, signal: AbortSignal.timeout(15_000) });
  // Only GitHub's limit stops a run: it is shared by every remaining call. Registry limits fail one package.
  const host = new URL(url).host;
  if (host === 'api.github.com' && (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'))) {
    throw new RateLimitError(`rate limited by ${host}`);
  }
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${url}`);
  return res;
}

export async function getJson<T>(f: FetchFn, url: string, headers: Record<string, string> = {}): Promise<T> {
  return (await request(f, url, headers)).json() as Promise<T>;
}

export async function getText(f: FetchFn, url: string, headers: Record<string, string> = {}): Promise<string> {
  return (await request(f, url, headers)).text();
}
