/**
 * Open-Meteo (open-meteo.com) provider for NOAA's High-Resolution Rapid Refresh (HRRR) model.
 *
 * Open-Meteo serves HRRR's native 15-minute output for the 3 km grid cell containing a point and
 * allows CORS, so the same code runs at build time and in the browser. With `past_days`, past
 * times are stitched from the first hours of successive runs, i.e. short-range forecasts.
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
}

/**
 * Open-Meteo labels 15-minute values by the *end* of the interval they average or sum
 * ("preceding 15 minutes"); shift the labels to interval starts.
 */
export function normalizeMinutely15(json: any, model = HRRR_MODEL, runInit: string | null = null): ModelSeries {
  const m = json.minutely_15;
  const dt = 900;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
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

/** HRRR at a point: the past day of short-range forecasts and the latest run's forecast ahead. */
export async function getHrrr(lat: number, lon: number, o: FetchOptions = {}): Promise<ModelSeries> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    models: HRRR_MODEL,
    minutely_15: 'shortwave_radiation,diffuse_radiation,precipitation',
    past_days: '1',
    forecast_days: '2',
    timezone: 'GMT',
    timeformat: 'unixtime',
  });
  const [data, meta] = await Promise.all([
    getJson(`${OPENMETEO_API}/v1/forecast?${q}`, o),
    // Run metadata is a nicety for the caption; don't fail the series without it.
    getJson(`${OPENMETEO_API}/data/${HRRR_MODEL}/static/meta.json`, o).catch(() => null),
  ]);
  const init = meta?.last_run_initialisation_time;
  return normalizeMinutely15(data, HRRR_MODEL, typeof init === 'number' ? new Date(init * 1000).toISOString() : null);
}
