export type Ecosystem = 'npm' | 'pypi' | 'actions' | 'docker' | 'infra';
export type Pin = 'exact' | 'range' | 'floating' | 'sha' | 'digest' | 'unsupported';
export type Bump = 'major' | 'minor' | 'patch';

export interface Found {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  pin: Pin;
}

export interface FoundIn extends Found {
  file: string;
}

export interface Release {
  version: string;
  publishedAt: string | null;
  url: string | null;
  notes: string | null;
}

// Pins whose version can be compared against releases.
export const COMPARABLE: ReadonlySet<Pin> = new Set<Pin>(['exact', 'range', 'digest']);
