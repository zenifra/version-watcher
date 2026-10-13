import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const sha = (s: string) => createHash('sha256').update(s).digest();
const mac = (password: string, issuedAt: number) => createHmac('sha256', password).update(String(issuedAt)).digest('base64url');

export function passwordMatches(input: unknown, password: string): boolean {
  return typeof input === 'string' && timingSafeEqual(sha(input), sha(password));
}

// "<issuedAt>.<hmac>": stateless, and changing AUTH_PASSWORD revokes every session.
export function issueSession(password: string, now: number): string {
  return `${now}.${mac(password, now)}`;
}

export function sessionValid(password: string, value: string | undefined, now: number): boolean {
  const [issued, sig] = (value ?? '').split('.');
  const at = Number(issued);
  if (!sig || !Number.isInteger(at) || at > now + 60_000 || now - at > MAX_AGE_MS) return false;
  return timingSafeEqual(sha(sig), sha(mac(password, at)));
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
