import type { Found, Pin } from '../types.ts';
import { parseVersion } from '../version.ts';

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/;

export function readWorkflow(text: string): Found[] {
  const out: Found[] = [];
  for (const line of text.split('\n')) {
    const ref = USES.exec(line)?.[1];
    if (!ref || ref.startsWith('./') || ref.startsWith('docker://')) continue;
    const at = ref.lastIndexOf('@');
    if (at < 0) continue;
    // owner/repo[/path] -> owner/repo, which is where releases live.
    const name = ref.slice(0, at).split('/').slice(0, 2).join('/');
    const version = ref.slice(at + 1);
    const pin: Pin = /^[0-9a-f]{40}$/i.test(version) ? 'sha' : parseVersion(version) ? 'exact' : 'floating';
    out.push({ ecosystem: 'actions', name, version, pin });
  }
  return out;
}
