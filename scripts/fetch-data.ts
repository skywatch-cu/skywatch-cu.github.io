/**
 * Build-time data fetch from the legacy Skywatch server.
 *
 * Writes:
 *   .cache/snapshot.json          current readings, today's plot images, special-event list
 *   public/data/series/<id>.json  last 24 h of each logged instrument, 1-min bins
 *   public/data/forecast.json     NWS forecast, hourly forecast, alerts and forecast discussion
 *
 * If a source fails, the previous output (restored from the Actions cache in CI) is kept,
 * so a legacy-server outage leaves stale data on the site rather than failing the deploy.
 *
 * Run: node scripts/fetch-data.ts   (Node >= 22.18 strips TypeScript types natively)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { INSTRUMENTS, STATION, type Instrument } from '../src/data/instruments.ts';
import { binSeries, denverDate, parseDat } from '../src/lib/dat.ts';
import { LEGACY_ORIGIN, parseEvents, parsePlotImages, parseStatus } from '../src/lib/legacy.ts';
import { DEFAULT_GRID, getBundle, NWS_USER_AGENT, resolveGrid, type ForecastBundle } from '../src/lib/providers/nws.ts';
import type { Snapshot, SeriesFile } from '../src/lib/types.ts';

const CACHE = new URL('../.cache/', import.meta.url);
const SERIES_DIR = new URL('../public/data/series/', import.meta.url);
const FORECAST_FILE = new URL('../public/data/forecast.json', import.meta.url);
const WINDOW_SEC = 86_400;

async function get(path: string): Promise<string> {
  const res = await fetch(`${LEGACY_ORIGIN}${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.text();
}

const round1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

async function buildSeries(inst: Instrument, now: Date): Promise<SeriesFile> {
  const spec = inst.series!;
  const cols = spec.fields.map((f) => f.col);
  // The last 24 h always lies within today's and yesterday's local-day files.
  const days = [denverDate(now, -1), denverDate(now, 0)];
  const texts = await Promise.allSettled(
    days.map(({ yy, mm, dd }) => get(`/data/${spec.dir}/${spec.prefix}_${yy}_${mm}_${dd}.dat`)),
  );
  const t: number[] = [];
  const raw: number[][] = cols.map(() => []);
  for (const r of texts) {
    if (r.status !== 'fulfilled') continue;
    const tbl = parseDat(r.value, cols);
    t.push(...tbl.t);
    tbl.cols.forEach((c, i) => {
      const f = spec.fields[i];
      for (const v of c) raw[i].push(f.zeroIsNull && v === 0 ? Number.NaN : v * (f.scale ?? 1));
    });
  }
  if (!t.length) throw new Error(`no rows for ${inst.id}: ${texts.map((r) => (r.status === 'rejected' ? r.reason : 'empty')).join('; ')}`);

  const binned = binSeries(t, raw, spec.fields.map((f) => f.reducer));
  const tEnd = binned.t[binned.t.length - 1];
  const keep = binned.t.map((x) => x > tEnd - WINDOW_SEC);
  const outT = binned.t.filter((_, i) => keep[i]);
  const data: Record<string, (number | null)[]> = {};
  spec.fields.forEach((f, k) => {
    data[f.key] = binned.cols[k].filter((_, i) => keep[i]).map(round1);
  });
  for (const d of spec.derived ?? []) {
    data[d.key] = outT.map((_, i) => {
      const row: Record<string, number | null> = {};
      for (const f of spec.fields) row[f.key] = data[f.key][i];
      return round1(d.from(row));
    });
  }

  return {
    id: inst.id,
    generatedAt: now.toISOString(),
    intervalSec: 60,
    t: outT,
    fields: [
      ...spec.fields.map(({ key, label, unit, color }) => ({ key, label, unit, color })),
      ...(spec.derived ?? []).map(({ key, label, unit, color }) => ({ key, label, unit, color })),
    ],
    data,
  };
}

async function readPrevious(): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(new URL('snapshot.json', CACHE), 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}

async function readJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** NWS forecast for the station. Re-resolves the grid each run (NWS occasionally re-grids an office). */
async function buildForecast(errors: string[]): Promise<void> {
  const o = { userAgent: NWS_USER_AGENT };
  const prev = await readJson<ForecastBundle>(FORECAST_FILE);
  const grid = await resolveGrid(STATION.lat, STATION.lon, o).catch((e) => {
    errors.push(`NWS grid lookup: ${e.message}`);
    return prev?.grid ?? DEFAULT_GRID;
  });
  const { bundle, errors: errs } = await getBundle(STATION.lat, STATION.lon, grid, o, prev);
  errors.push(...errs);
  await writeFile(FORECAST_FILE, JSON.stringify(bundle));
}

async function main() {
  const now = new Date();
  await mkdir(CACHE, { recursive: true });
  await mkdir(SERIES_DIR, { recursive: true });
  const prev = await readPrevious();
  const errors: string[] = [];

  const snapshot: Snapshot = {
    fetchedAt: now.toISOString(),
    status: prev?.status ?? null,
    statusFresh: false,
    images: prev?.images ?? {},
    events: prev?.events ?? [],
    series: prev?.series ?? {},
    errors,
  };

  const pages = INSTRUMENTS.filter((i) => i.legacyPage).map((i) => i.legacyPage!);
  const jobs: Promise<void>[] = [
    get('/').then((html) => {
      snapshot.status = parseStatus(html);
      snapshot.statusFresh = true;
    }),
    get('/php/event.php').then((html) => {
      snapshot.events = parseEvents(html);
    }),
    ...pages.map((p) =>
      get(`/php/${p}.php`).then((html) => {
        snapshot.images[p] = parsePlotImages(html);
      }),
    ),
    ...INSTRUMENTS.filter((i) => i.series).map((inst) =>
      buildSeries(inst, now).then(async (file) => {
        await writeFile(new URL(`${inst.id}.json`, SERIES_DIR), JSON.stringify(file));
        snapshot.series[inst.id] = { generatedAt: file.generatedAt, lastSample: file.t.at(-1) ?? null };
      }),
    ),
  ];

  const nwsErrors: string[] = [];
  const [results] = await Promise.all([Promise.allSettled(jobs), buildForecast(nwsErrors)]);
  for (const r of results) if (r.status === 'rejected') errors.push(String(r.reason?.message ?? r.reason));

  await writeFile(new URL('snapshot.json', CACHE), JSON.stringify(snapshot, null, 1));
  const ok = results.length - errors.length;
  console.log(`fetch-data: ${ok}/${results.length} sources OK`);
  for (const e of errors) console.warn(`  ! ${e}`);
  console.log(`fetch-data: NWS forecast ${nwsErrors.length ? `with ${nwsErrors.length} error(s)` : 'OK'}`);
  for (const e of nwsErrors) console.warn(`  ! ${e}`);
}

await main();
