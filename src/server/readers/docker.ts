import type { Found } from '../types.ts';

const HUB = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io']);
const PATTERNS = ['#', '#.#', '#.#.#'];

export function readDockerfile(text: string): Found[] {
  const stages = new Set<string>();
  const out: Found[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*FROM\s+(.+)$/i.exec(line);
    if (!m) continue;
    const tokens = m[1].trim().split(/\s+/).filter((t) => !t.startsWith('--'));
    const ref = tokens[0];
    const skip = !ref || ref === 'scratch' || ref.includes('$') || stages.has(ref.toLowerCase());
    if (tokens[1]?.toLowerCase() === 'as' && tokens[2]) stages.add(tokens[2].toLowerCase());
    if (!skip) out.push(parseImageRef(ref));
  }
  return out;
}

export function parseImageRef(ref: string): Found {
  const [nameTag, digest] = ref.split('@');
  const slash = nameTag.lastIndexOf('/');
  const colon = nameTag.lastIndexOf(':');
  const tag = colon > slash ? nameTag.slice(colon + 1) : 'latest';
  let image = colon > slash ? nameTag.slice(0, colon) : nameTag;
  const first = image.split('/')[0];
  const hasRegistry = image.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  if (hasRegistry && !HUB.has(first)) {
    return { ecosystem: 'docker', name: `${image}:${tag}`, version: tag, pin: 'unsupported' };
  }
  if (hasRegistry) image = image.slice(first.length + 1);
  image = image.replace(/^library\//, '');
  const m = /^(\d+(?:\.\d+){0,2})(?:-(.+))?$/.exec(tag);
  if (!m) return { ecosystem: 'docker', name: `${image}:${tag}`, version: tag, pin: 'floating' };
  const pattern = PATTERNS[m[1].split('.').length - 1] + (m[2] ? `-${m[2]}` : '');
  return { ecosystem: 'docker', name: `${image}:${pattern}`, version: m[1], pin: digest ? 'digest' : 'exact' };
}
