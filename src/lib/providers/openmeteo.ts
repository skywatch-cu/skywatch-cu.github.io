/**
 * Open-Meteo (open-meteo.com) provider for NOAA's High-Resolution Rapid Refresh (HRRR) model.
 *
 * Open-Meteo serves HRRR's native 15-minute output for the 3 km grid cell containing a point and
 * allows CORS, so the same code runs at build time and in the browser. With `past_days`, past
 * times are stitched from the first hours of successive runs, i.e. short-range forecasts.
 * The previous-runs endpoint adds day-ahead values: for each time, the forecast from a 48-h HRRR
 * run started 24–30 h earlier (verified against single runs for 2026-11-06).
 * Data are CC BY 4.0 and must be credited to Open-Meteo.
 */

export const OPENMETEO_API = 'https://api.open-meteo.com';
export const HRRR_MODEL = 'ncep_hrrr_conus';

/** public/data/hrrr.json */
export interface ModelSeries {
  model: string;
  fetchedAt: string;
  /** Initialisation time of the latest run Open-Meteo holds (ISO-8601 UTC), when known. */
  runInit: string | null;
  /** Centre and elevation of the model grid cell (m). */
  cell: { lat: number; lon: number; elevation: number };
  intervalSec: number;
  /** Interval start times, Unix seconds UTC (the same convention as the observed series files). */
  t: number[];
  /** Global horizontal irradiance, mean over the interval, W m⁻². */
  ghi: (number | null)[];
  /** Diffuse horizontal irradiance, mean over the interval, W m⁻². */
  diffuse: (number | null)[];
  /** Precipitation total over the interval, mm. */
  precip: (number | null)[];
  /** The same fields forecast about a day ahead, aligned on `t`; null when unavailable. */
  dayAhead?: ModelFields | null;
}

export type ModelFields = Pick<ModelSeries, 'ghi' | 'diffuse' | 'precip'>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Open-Meteo labels 15-minute values by the *end* of the interval they average or sum
 * ("preceding 15 minutes"); shift the labels to interval starts.
 */
export function normalizeMinutely15(json: any, model = HRRR_MODEL, runInit: string | null = null): ModelSeries {
  const m = json.minutely_15;
  const dt = 900;
  // Trim trailing intervals past the model's horizon, where every field is null.
  let n = m.time.length;
  while (n > 0 && m.shortwave_radiation[n - 1] == null && m.precipitation[n - 1] == null) n--;
  return {
    model,
    fetchedAt: new Date().toISOString(),
    runInit,
    cell: { lat: json.latitude, lon: json.longitude, elevation: json.elevation },
    intervalSec: dt,
    t: (m.time as number[]).slice(0, n).map((x) => x - dt),
    ghi: (m.shortwave_radiation as unknown[]).slice(0, n).map(num),
    diffuse: (m.diffuse_radiation as unknown[]).slice(0, n).map(num),
    precip: (m.precipitation as unknown[]).slice(0, n).map(num),
  };
}

/**
 * Day-ahead fields from the previous-runs endpoint (`<var>_previous_day1`), re-indexed onto the
 * interval starts `t` of the latest series. Times without a day-ahead value get null.
 */
export function normalizeDayAhead(json: any, t: number[], dt = 900): ModelFields {
  const m = json.minutely_15;
  const idx = new Map<number, number>((m.time as number[]).map((x, i) => [x - dt, i]));
  const pick = (key: string) => t.map((s) => (idx.has(s) ? num(m[`${key}_previous_day1`][idx.get(s)!]) : null));
  return { ghi: pick('shortwave_radiation'), diffuse: pick('diffuse_radiation'), precip: pick('precipitation') };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchOptions {
  fetch?: Fetch;
  timeoutMs?: number;
}

async function getJson(url: string, o: FetchOptions): Promise<any> {
  const res = await (o.fetch ?? fetch)(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} for ${url.replace(OPENMETEO_API, '')}`);
  return res.json();
}

export const PREVIOUS_RUNS_API = 'https://previous-runs-api.open-meteo.com';

/**
 * HRRR at a point: the past day of short-range forecasts, the latest run's forecast ahead and,
 * when available, the day-ahead forecasts for the past day.
 */
export async function getHrrr(lat: number, lon: number, o: FetchOptions = {}): Promise<ModelSeries> {
  const q = (fields: string[], days: number) =>
    new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      models: HRRR_MODEL,
      minutely_15: fields.join(','),
      past_days: '1',
      forecast_days: String(days),
      timezone: 'GMT',
      timeformat: 'unixtime',
    });
  const fields = ['shortwave_radiation', 'diffuse_radiation', 'precipitation'];
  const [data, meta, day1] = await Promise.all([
    getJson(`${OPENMETEO_API}/v1/forecast?${q(fields, 2)}`, o),
    // Run metadata and day-ahead values are extras; don't fail the series without them.
    getJson(`${OPENMETEO_API}/data/${HRRR_MODEL}/static/meta.json`, o).catch(() => null),
    getJson(`${PREVIOUS_RUNS_API}/v1/forecast?${q(fields.map((f) => `${f}_previous_day1`), 1)}`, o).catch(() => null),
  ]);
  const init = meta?.last_run_initialisation_time;
  const series = normalizeMinutely15(data, HRRR_MODEL, typeof init === 'number' ? new Date(init * 1000).toISOString() : null);
  series.dayAhead = day1 ? normalizeDayAhead(day1, series.t, series.intervalSec) : null;
  return series;
}
