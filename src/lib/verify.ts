/**
 * Forecast-versus-observed comparison of HRRR (15-min intervals) with the station's 1-min series.
 * Pure functions, shared by the browser chart and the tests.
 */
import type { ModelSeries } from './providers/openmeteo.ts';

const rad = Math.PI / 180;

/**
 * Solar elevation angle (degrees) at Unix time `t` (s) from the USNO low-precision formulae,
 * accurate to about 0.01° for 1950–2050. Refraction is ignored.
 */
export function solarElevation(t: number, lat: number, lon: number): number {
  const d = t / 86_400 - 10_957.5; // days since J2000.0 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * rad; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude, deg
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const e = (23.439 - 3.6e-7 * d) * rad; // obliquity of the ecliptic
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const h = (gmst * 15 + lon) * rad - ra; // local hour angle
  const phi = lat * rad;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) / rad;
}

/**
 * Average 1-min observations (bin-start times `obsT`, ascending) over each interval
 * [start, start + sec). An interval needs at least `minFrac` of its samples, otherwise null.
 */
export function intervalMeans(
  obsT: number[],
  obsY: (number | null)[],
  starts: number[],
  sec: number,
  obsSec = 60,
  minFrac = 0.8,
): (number | null)[] {
  const need = Math.ceil((sec / obsSec) * minFrac);
  let j = 0;
  return starts.map((s) => {
    while (j < obsT.length && obsT[j] < s) j++;
    let sum = 0;
    let n = 0;
    for (let k = j; k < obsT.length && obsT[k] < s + sec; k++) {
      const v = obsY[k];
      if (v != null) {
        sum += v;
        n++;
      }
    }
    return n >= need ? sum / n : null;
  });
}

/**
 * Per-sample increments of a gauge's "accumulation since local midnight". A drop is the
 * midnight reset, so the increment is the new value. Missing samples carry the last value.
 */
export function accumIncrements(accum: (number | null)[]): number[] {
  let prev: number | null = null;
  return accum.map((a) => {
    if (a == null) return 0;
    const inc = prev == null ? 0 : a >= prev ? a - prev : a;
    prev = a;
    return inc;
  });
}

/** Running total, treating nulls as zero. */
export const cumsum = (xs: (number | null)[]): number[] => {
  let s = 0;
  return xs.map((x) => (s += x ?? 0));
};

export interface Score {
  /** Number of paired intervals. */
  n: number;
  /** Mean of (model − observed). */
  bias: number;
  rmse: number;
  obsMean: number;
}

/** Bias and RMSE over pairs where both values exist and `keep(i)` holds. */
export function score(obs: (number | null)[], model: (number | null)[], keep: (i: number) => boolean = () => true): Score | null {
  let n = 0;
  let sd = 0;
  let sd2 = 0;
  let so = 0;
  obs.forEach((o, i) => {
    const m = model[i];
    if (o == null || m == null || !keep(i)) return;
    const d = m - o;
    n++;
    sd += d;
    sd2 += d * d;
    so += o;
  });
  return n ? { n, bias: sd / n, rmse: Math.sqrt(sd2 / n), obsMean: so / n } : null;
}

/** Observed inputs: the 1-min series files' times and fields. */
export interface ObservedInputs {
  ghi?: { t: number[]; y: (number | null)[] };
  diffuse?: { t: number[]; y: (number | null)[] };
  /** Gauge accumulation since local midnight, mm. */
  accum?: { t: number[]; y: (number | null)[] };
}

export interface Comparison {
  /** Start and end (Unix s) of the verification window: the last 24 h of observations. */
  from: number;
  to: number;
  /** Model interval midpoints, for plotting. */
  modelMid: number[];
  ghi: { score: Score | null; obsMJ: number | null; modelMJ: number | null };
  diffuse: { score: Score | null };
  /** 24-h precipitation totals over the window, mm. */
  precip: { obs: number | null; model: number | null };
  /** Precipitation accumulated from the window start: observed (1-min) and model (15-min ends). */
  precipObsCum: (number | null)[];
  precipModelCum: (number | null)[];
}

const MJ = 1e-6;

/**
 * Pair the model with the observations over the last 24 h of observations. Scores use daytime
 * intervals only (solar elevation above 0° at the midpoint), since night-time zeros would
 * shrink the RMSE without saying anything about the forecast.
 */
export function compare(obs: ObservedInputs, model: ModelSeries, lat: number, lon: number): Comparison | null {
  const ends = [obs.ghi, obs.diffuse, obs.accum].filter(Boolean).map((s) => s!.t.at(-1)!);
  if (!ends.length) return null;
  const dt = model.intervalSec;
  const to = Math.max(...ends) + 60;
  const from = to - 86_400;
  const inWin = model.t.map((s) => s >= from && s + dt <= to);
  const mid = model.t.map((s) => s + dt / 2);
  const day = (i: number) => inWin[i] && solarElevation(mid[i], lat, lon) > 0;

  const ghiObs = obs.ghi ? intervalMeans(obs.ghi.t, obs.ghi.y, model.t, dt) : model.t.map(() => null);
  const difObs = obs.diffuse ? intervalMeans(obs.diffuse.t, obs.diffuse.y, model.t, dt) : model.t.map(() => null);

  // Insolation H = Σ G Δt over intervals where both exist, so the two totals cover the same time.
  let ho = 0;
  let hm = 0;
  let paired = 0;
  model.t.forEach((_, i) => {
    const o = ghiObs[i];
    const m = model.ghi[i];
    if (!inWin[i] || o == null || m == null) return;
    ho += Math.max(0, o) * dt;
    hm += m * dt;
    paired++;
  });
  const fullDay = paired >= 0.9 * (86_400 / dt);

  // Precipitation: both curves start at zero at the window start.
  let precipObsCum: (number | null)[] = [];
  let obsTotal: number | null = null;
  if (obs.accum) {
    const inc = accumIncrements(obs.accum.y).map((x, i) => (obs.accum!.t[i] >= from ? x : 0));
    const cum = cumsum(inc);
    precipObsCum = cum.map((c, i) => (obs.accum!.t[i] >= from ? c : null));
    obsTotal = cum.at(-1) ?? null;
  }
  const mInc = model.precip.map((p, i) => (model.t[i] >= from ? p : 0));
  const mCum = cumsum(mInc);
  const precipModelCum = model.t.map((s, i) => (s >= from ? mCum[i] : null));
  const lastIn = inWin.lastIndexOf(true);

  return {
    from,
    to,
    modelMid: mid,
    ghi: {
      score: score(ghiObs, model.ghi, day),
      obsMJ: fullDay ? ho * MJ : null,
      modelMJ: fullDay ? hm * MJ : null,
    },
    diffuse: { score: score(difObs, model.diffuse, day) },
    precip: { obs: obsTotal, model: lastIn >= 0 ? mCum[lastIn] : null },
    precipObsCum,
    precipModelCum,
  };
}
