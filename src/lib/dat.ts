/**
 * Parsers for the Skywatch logger files (`/data/<instrument>/<prefix>_YY_MM_DD.dat`).
 *
 * File conventions (observed across pyra, pyrg, spn, netrad, ozone, rain, ceil):
 * - Header lines start with ';'. The header carries the *local* (America/Denver) day,
 *   either as `;Date 2026/10/30 (local day ...)` or `;start time = 2026-10-30 05:30:40`.
 * - Each data row starts with a UTC time of day (hh:mm:ss). Columns are tab- or comma-delimited.
 * - A local day starts at 06:00 or 07:00 UTC, so the rows cross UTC midnight once. The UTC
 *   date of the first row equals the local date (local time is behind UTC and logging starts after
 *   local midnight), and each backwards jump in time-of-day advances the UTC date by one day.
 */

export interface DatTable {
  /** Local (Mountain) calendar day the file belongs to, YYYY-MM-DD. */
  localDate: string;
  /** Sample times, Unix seconds (UTC). */
  t: number[];
  /** One array per requested column; NaN for missing or unparseable values. */
  cols: number[][];
}

const LOCAL_DATE_RES = [
  /;\s*Date\s+(\d{4})\/(\d{2})\/(\d{2})/i,
  /;\s*start time\s*=\s*(\d{4})-(\d{2})-(\d{2})/i,
];

const HALF_DAY = 43_200;

export function parseDat(text: string, columns: number[]): DatTable {
  let ymd: [number, number, number] | null = null;
  const t: number[] = [];
  const cols: number[][] = columns.map(() => []);
  let dayOffset = 0;
  let prevSec = -1;
  let base = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(';')) {
      if (!ymd) {
        for (const re of LOCAL_DATE_RES) {
          const m = re.exec(line);
          if (m) {
            ymd = [Number(m[1]), Number(m[2]), Number(m[3])];
            base = Date.UTC(ymd[0], ymd[1] - 1, ymd[2]) / 1000;
            break;
          }
        }
      }
      continue;
    }
    if (!ymd) throw new Error('parseDat: no local date found in header');

    const fields = line.split(/[\s,]+/);
    const hms = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(fields[0]);
    if (!hms) continue;
    const sec = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    // Time of day jumping back by more than half a day means we crossed UTC midnight.
    if (prevSec >= 0 && sec + HALF_DAY < prevSec) dayOffset += 1;
    prevSec = sec;

    t.push(base + dayOffset * 86_400 + sec);
    columns.forEach((c, i) => {
      const v = Number.parseFloat(fields[c] ?? '');
      cols[i].push(Number.isFinite(v) ? v : Number.NaN);
    });
  }

  if (!ymd) throw new Error('parseDat: no local date found in header');
  const localDate = `${ymd[0]}-${String(ymd[1]).padStart(2, '0')}-${String(ymd[2]).padStart(2, '0')}`;
  return { localDate, t, cols };
}

export type Reducer = 'mean' | 'last';

/**
 * Aggregate irregular samples onto fixed bins (default 60 s), labelled by bin start.
 * NaN inputs are skipped; an empty bin yields null.
 */
export function binSeries(
  t: number[],
  cols: number[][],
  reducers: Reducer[],
  binSec = 60,
): { t: number[]; cols: (number | null)[][] } {
  const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const outT: number[] = [];
  const outCols: (number | null)[][] = cols.map(() => []);
  let cur = Number.NaN;
  let sums = cols.map(() => 0);
  let counts = cols.map(() => 0);
  let lasts: (number | null)[] = cols.map(() => null);

  const flush = () => {
    if (Number.isNaN(cur)) return;
    outT.push(cur);
    cols.forEach((_, k) => {
      outCols[k].push(reducers[k] === 'last' ? lasts[k] : counts[k] ? sums[k] / counts[k] : null);
    });
  };

  for (const i of order) {
    const bin = Math.floor(t[i] / binSec) * binSec;
    if (bin !== cur) {
      flush();
      cur = bin;
      sums = cols.map(() => 0);
      counts = cols.map(() => 0);
      lasts = cols.map(() => null);
    }
    cols.forEach((col, k) => {
      const v = col[i];
      if (Number.isNaN(v)) return;
      sums[k] += v;
      counts[k] += 1;
      lasts[k] = v;
    });
  }
  flush();
  return { t: outT, cols: outCols };
}

/** The current calendar date in America/Denver, shifted by `offsetDays`. */
export function denverDate(now: Date, offsetDays = 0): { yy: string; mm: string; dd: string } {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { yy: get('year').slice(2), mm: get('month'), dd: get('day') };
}
