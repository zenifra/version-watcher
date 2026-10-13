import type { Found } from '../types.ts';
import { minFromRange } from '../version.ts';

const REQUIREMENT = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(===|==|~=|>=|>)\s*([^\s,;#]+)/;

// PEP 503 normalized name.
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function parseRequirement(line: string): Found | null {
  const m = REQUIREMENT.exec(line.trim());
  if (!m) return null;
  const [, name, op, raw] = m;
  const exact = (op === '==' || op === '===') && !raw.includes('*');
  const version = exact ? raw : minFromRange(raw);
  if (!version) return null;
  return { ecosystem: 'pypi', name: normalizeName(name), version, pin: exact ? 'exact' : 'range' };
}

const isFound = (f: Found | null): f is Found => f !== null;

export function readRequirements(text: string): Found[] {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter((line) => line && !line.startsWith('-'))
    .map(parseRequirement)
    .filter(isFound);
}

export function readPyproject(text: string): Found[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '[project]');
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith('['));
  const section = lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  const open = /^\s*dependencies\s*=\s*\[/m.exec(section);
  if (!open) return [];
  const from = open.index + open[0].length;
  let i = from;
  let quote = '';
  for (; i < section.length; i++) {
    const c = section[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ']') break;
  }
  return [...section.slice(from, i).matchAll(/"([^"]*)"|'([^']*)'/g)]
    .map((m) => parseRequirement(m[1] ?? m[2]))
    .filter(isFound);
}
