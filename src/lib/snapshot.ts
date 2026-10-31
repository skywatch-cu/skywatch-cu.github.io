import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from './types.ts';

const EMPTY: Snapshot = {
  fetchedAt: new Date(0).toISOString(),
  status: null,
  statusFresh: false,
  images: {},
  events: [],
  series: {},
  errors: ['No data snapshot: run `npm run fetch-data` before building.'],
};

let cached: Snapshot | null = null;

/** Build-time snapshot (resolved from the project root: Astro bundles this module, so
 * import.meta.url would not point into src/). Written by scripts/fetch-data.ts (read once per build). */
export function getSnapshot(): Snapshot {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(join(process.cwd(), '.cache/snapshot.json'), 'utf8'));
  } catch {
    cached = EMPTY;
  }
  return cached!;
}
