import type { EventImage, PlotImage, Status } from './legacy.ts';

export interface SeriesField {
  key: string;
  label: string;
  unit: string;
  /** CSS custom property name, e.g. "--c-sw". */
  color: string;
}

/** public/data/series/<id>.json */
export interface SeriesFile {
  id: string;
  generatedAt: string;
  intervalSec: number;
  /** Bin start times, Unix seconds UTC. */
  t: number[];
  fields: SeriesField[];
  data: Record<string, (number | null)[]>;
}

/** .cache/snapshot.json */
export interface Snapshot {
  fetchedAt: string;
  status: Status | null;
  /** False when the homepage fetch failed and `status` was carried over from a previous run. */
  statusFresh: boolean;
  /** Today's plot images keyed by legacy php page. */
  images: Record<string, PlotImage[]>;
  events: EventImage[];
  series: Record<string, { generatedAt: string; lastSample: number | null }>;
  errors: string[];
}
