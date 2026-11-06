/**
 * Browser-side forecast store. First paint uses the build-time copy (public/data/forecast.json);
 * the page then fetches the NWS API directly (it allows CORS) and refreshes every 15 min while
 * visible, so forecasts stay current even when the scheduled site rebuild is delayed.
 */
import { STATION } from '../data/instruments.ts';
import { DEFAULT_GRID, getBundle, type ForecastBundle } from './providers/nws.ts';
import { getUnits, type UnitSystem } from './units.ts';

/** `live`: null until the first direct NWS request settles, then whether it succeeded. */
type Listener = (b: ForecastBundle, u: UnitSystem, live: boolean | null) => void;

const REFRESH_MS = 15 * 60_000;
const listeners: Listener[] = [];
let current: ForecastBundle | null = null;
let live: boolean | null = null;
let started = false;

const emit = () => current && listeners.forEach((fn) => fn(current!, getUnits(), live));

async function refresh() {
  try {
    const { bundle, errors } = await getBundle(STATION.lat, STATION.lon, current?.grid ?? DEFAULT_GRID, {}, current);
    // A failed alerts request returns null; keep the last list rather than blanking the banner.
    current = { ...bundle, alerts: bundle.alerts ?? current?.alerts ?? null };
    live = !errors.some((e) => e.includes('/forecast'));
  } catch {
    return;
  }
  emit();
}

async function start() {
  if (started) return;
  started = true;
  try {
    const r = await fetch('/data/forecast.json', { cache: 'no-cache' });
    if (r.ok) current = await r.json();
  } catch {}
  emit();
  await refresh();
  let last = Date.now();
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      last = Date.now();
      refresh();
    }
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last > REFRESH_MS) {
      last = Date.now();
      refresh();
    }
  });
  window.addEventListener('unitchange', emit);
}

/** Call `fn` now (if data is loaded) and whenever the forecast or the unit choice changes. */
export function onForecast(fn: Listener) {
  listeners.push(fn);
  if (current) fn(current, getUnits(), live);
  start();
}
