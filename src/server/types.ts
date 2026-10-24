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

// What a registry knows about a package. notesRepo is the GitHub repository
// ("owner/name") whose releases carry the notes the registry itself lacks.
export interface Releases {
  releases: Release[];
  notesRepo: string | null;
}

// Pins whose version can be compared against releases.
export const COMPARABLE: ReadonlySet<Pin> = new Set<Pin>(['exact', 'range', 'digest']);
