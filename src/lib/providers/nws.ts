/**
 * National Weather Service API (api.weather.gov) provider.
 *
 * The API sends `Access-Control-Allow-Origin: *`, so the same code runs at build time
 * (Node, with the identifying User-Agent the NWS asks for) and in the browser (where a
 * User-Agent cannot be set). Everything here is normalized to SI units; conversion to
 * US customary units happens only for display (src/lib/units.ts).
 */

export const NWS_API = 'https://api.weather.gov';
/** NWS asks API clients to identify themselves with a contact address. */
export const NWS_USER_AGENT = 'skywatch-cu.github.io (aneeshcs@colorado.edu)';

/** Resolved from /points/40.01,-105.24 on 2026-11-02. Rebuilt at build time in case NWS re-grids. */
export const DEFAULT_GRID: NwsGrid = {
  office: 'BOU',
  gridX: 55,
  gridY: 74,
  radar: 'KFTG',
  forecastZone: 'COZ039',
  county: 'COC013',
};

export interface NwsGrid {
  office: string;
  gridX: number;
  gridY: number;
  radar: string;
  forecastZone: string;
  county: string;
}

export interface ForecastPeriod {
  name: string;
  /** ISO-8601 with local offset, as issued. */
  start: string;
  end: string;
  isDaytime: boolean;
  tempC: number | null;
  dewpointC: number | null;
  relHumidity: number | null;
  /** Probability of precipitation, %. */
  pop: number | null;
  /** Wind speed range, m s⁻¹ (equal bounds when NWS gives one value). */
  windMs: [number, number] | null;
  windDir: string;
  short: string;
  detailed: string;
}

export interface Forecast {
  /** When the NWS last updated the gridded forecast. */
  updated: string;
  periods: ForecastPeriod[];
}

export interface Alert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  onset: string | null;
  ends: string | null;
  description: string;
  instruction: string;
  sender: string;
}

export interface DiscussionSection {
  title: string;
  /** Text after the section heading on the same line, e.g. "/Through Tuesday/". */
  note: string;
  body: string;
}

export interface Discussion {
  issued: string;
  office: string;
  sections: DiscussionSection[];
}

/** public/data/forecast.json: the build-time copy, used for first paint and as a fallback. */
export interface ForecastBundle {
  fetchedAt: string;
  grid: NwsGrid;
  forecast: Forecast | null;
  hourly: Forecast | null;
  alerts: Alert[] | null;
  discussion: Discussion | null;
}

// ---------------------------------------------------------------------------
// Normalizers (pure; unit-tested against saved responses in tests/fixtures/nws/)

const MPH = 0.44704; // m s⁻¹ per mph
const KMH = 1 / 3.6;
const fToC = (f: number) => ((f - 32) * 5) / 9;

interface QV {
  unitCode?: string;
  value: number | null;
}
const qv = (q: QV | undefined | null) => (q && typeof q.value === 'number' ? q.value : null);

/** "5 mph", "10 to 15 mph", "20 km/h" → [min, max] in m s⁻¹. */
export function parseWind(s: string | undefined): [number, number] | null {
  if (!s) return null;
  const nums = s.match(/\d+(\.\d+)?/g)?.map(Number);
  if (!nums?.length) return null;
  const k = /km\/h/i.test(s) ? KMH : MPH;
  return [nums[0] * k, nums[nums.length - 1] * k];
}

export function normalizeForecast(json: any): Forecast {
  const p = json.properties;
  return {
    updated: p.updateTime ?? p.generatedAt,
    periods: (p.periods as any[]).map((r) => {
      const t = typeof r.temperature === 'number' ? r.temperature : qv(r.temperature);
      const unit = r.temperatureUnit ?? (r.temperature?.unitCode?.endsWith('degF') ? 'F' : 'C');
      return {
        name: r.name ?? '',
        start: r.startTime,
        end: r.endTime,
        isDaytime: Boolean(r.isDaytime),
        tempC: t == null ? null : unit === 'F' ? fToC(t) : t,
        dewpointC: qv(r.dewpoint),
        relHumidity: qv(r.relativeHumidity),
        pop: qv(r.probabilityOfPrecipitation) ?? 0,
        windMs: parseWind(r.windSpeed),
        windDir: r.windDirection ?? '',
        short: r.shortForecast ?? '',
        detailed: r.detailedForecast ?? '',
      };
    }),
  };
}

const SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor'] as const;

export function normalizeAlerts(json: any): Alert[] {
  return (json.features as any[])
    .map(({ properties: a }) => ({
      id: a.id,
      event: a.event,
      severity: (SEVERITIES as readonly string[]).includes(a.severity) ? a.severity : 'Unknown',
      headline: a.headline ?? a.event,
      onset: a.onset ?? a.effective ?? null,
      ends: a.ends ?? a.expires ?? null,
      description: a.description ?? '',
      instruction: a.instruction ?? '',
      sender: a.senderName ?? '',
    }))
    .sort((x, y) => SEVERITIES.indexOf(x.severity as any) - SEVERITIES.indexOf(y.severity as any)) as Alert[];
}

/**
 * Split an Area Forecast Discussion into its dotted sections (.KEY MESSAGES..., .DISCUSSION...).
 * Sections end at "&&" or the next heading; the WMO header and "$$" trailer are dropped.
 */
export function parseDiscussion(text: string, issued: string, office: string): Discussion {
  const sections: DiscussionSection[] = [];
  let cur: DiscussionSection | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (cur) sections.push({ ...cur, body: lines.join('\n').trim() });
    cur = null;
    lines.length = 0;
  };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    // ".KEY MESSAGES...", ".DISCUSSION /Through Tuesday/...", ".AVIATION /18Z TAFS/... text"
    const h = line.match(/^\.([A-Z][A-Z0-9 /&-]*?)(?:\s+\/([^/]+)\/)?\.\.\.\s*(.*)$/);
    if (h) {
      flush();
      cur = { title: h[1].trim(), note: (h[2] ?? '').trim(), body: '' };
      if (h[3]) lines.push(h[3]);
    } else if (/^(&&|\$\$)\s*$/.test(line)) {
      flush();
    } else if (cur) {
      lines.push(line.replace(/\s+$/, ''));
    }
  }
  flush();
  return { issued, office, sections };
}

/** Paragraphs and "- " bullet lists from a fixed-width NWS text block (lines hard-wrapped at ~70 chars). */
export function textBlocks(body: string): ({ kind: 'p'; text: string } | { kind: 'ul'; items: string[] })[] {
  const out: ({ kind: 'p'; text: string } | { kind: 'ul'; items: string[] })[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const ls = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!ls.length) continue;
    if (ls[0].startsWith('- ')) {
      const items: string[] = [];
      for (const l of ls) l.startsWith('- ') ? items.push(l.slice(2)) : (items[items.length - 1] += ` ${l}`);
      const last = out[out.length - 1];
      // Bullets in key messages are separated by blank lines; merge them into one list.
      if (last?.kind === 'ul') last.items.push(...items);
      else out.push({ kind: 'ul', items });
    } else {
      out.push({ kind: 'p', text: ls.join(' ') });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchOptions {
  fetch?: Fetch;
  /** Set at build time only; browsers forbid overriding User-Agent. */
  userAgent?: string;
  timeoutMs?: number;
}

async function getJson(path: string, o: FetchOptions): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/geo+json' };
  if (o.userAgent) headers['User-Agent'] = o.userAgent;
  const res = await (o.fetch ?? fetch)(`${NWS_API}${path}`, {
    headers,
    signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${path}`);
  return res.json();
}

export async function resolveGrid(lat: number, lon: number, o: FetchOptions = {}): Promise<NwsGrid> {
  const p = (await getJson(`/points/${lat.toFixed(4)},${lon.toFixed(4)}`, o)).properties;
  const tail = (u: string) => u.split('/').pop()!;
  return {
    office: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
    radar: p.radarStation,
    forecastZone: tail(p.forecastZone),
    county: tail(p.county),
  };
}

const gridPath = (g: NwsGrid) => `/gridpoints/${g.office}/${g.gridX},${g.gridY}`;

export const getForecast = async (g: NwsGrid, o: FetchOptions = {}) =>
  normalizeForecast(await getJson(`${gridPath(g)}/forecast`, o));
export const getHourly = async (g: NwsGrid, o: FetchOptions = {}) =>
  normalizeForecast(await getJson(`${gridPath(g)}/forecast/hourly`, o));
export const getAlerts = async (lat: number, lon: number, o: FetchOptions = {}) =>
  normalizeAlerts(await getJson(`/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, o));

export async function getDiscussion(g: NwsGrid, o: FetchOptions = {}): Promise<Discussion> {
  const list = await getJson(`/products/types/AFD/locations/${g.office}`, o);
  const latest = list['@graph']?.[0];
  if (!latest) throw new Error(`NWS: no AFD listed for ${g.office}`);
  const prod = await getJson(`/products/${latest.id}`, o);
  return parseDiscussion(prod.productText, prod.issuanceTime, g.office);
}

/**
 * Fetch everything for one point. Each part fails independently and falls back to `prev`,
 * because the gridpoint endpoints return intermittent 500s.
 */
export async function getBundle(
  lat: number,
  lon: number,
  grid: NwsGrid,
  o: FetchOptions = {},
  prev?: ForecastBundle | null,
): Promise<{ bundle: ForecastBundle; errors: string[] }> {
  const parts = await Promise.allSettled([
    getForecast(grid, o),
    getHourly(grid, o),
    getAlerts(lat, lon, o),
    getDiscussion(grid, o),
  ]);
  const errors = parts.flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
  const val = <T,>(i: number, fallback: T): T => (parts[i].status === 'fulfilled' ? (parts[i] as PromiseFulfilledResult<T>).value : fallback);
  return {
    bundle: {
      fetchedAt: new Date().toISOString(),
      grid,
      forecast: val(0, prev?.forecast ?? null),
      hourly: val(1, prev?.hourly ?? null),
      // Never carry stale alerts forward: an expired warning shown as active is worse than none.
      alerts: val(2, null),
      discussion: val(3, prev?.discussion ?? null),
    },
    errors,
  };
}
