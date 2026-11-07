import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeDayAhead, normalizeMinutely15 } from '../src/lib/providers/openmeteo.ts';
import { renderScores } from '../src/lib/render/verify.ts';
import { accumIncrements, compare, cumsum, intervalMeans, score, solarElevation, windowEnd, withLead } from '../src/lib/verify.ts';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/openmeteo/${name}`, import.meta.url), 'utf8'));
const model = normalizeMinutely15(fx('hrrr.json'));
const day1 = fx('hrrr-day1.json');
const LAT = 40.01;
const LON = -105.24;

describe('normalizeMinutely15', () => {
  it('relabels intervals by their start and trims past the horizon', () => {
    expect(model.intervalSec).toBe(900);
    expect(model.t[0]).toBe(1793923200 - 900);
    expect(model.cell.elevation).toBe(1603);
    const m = { time: [900, 1800, 2700], shortwave_radiation: [5, null, null], diffuse_radiation: [1, null, null], precipitation: [0, null, null] };
    const s = normalizeMinutely15({ latitude: 0, longitude: 0, elevation: 0, minutely_15: m });
    expect(s.t).toEqual([0]);
    expect(s.ghi).toEqual([5]);
  });
});

describe('solarElevation', () => {
  it('matches the noon elevation 90° − φ + δ at Boulder in early November', () => {
    // Solar noon on 2026-11-07 is about 11:45 MST (18:45 UTC); δ ≈ −16.4°.
    const noon = Date.UTC(2026, 10, 7, 18, 45) / 1000;
    expect(solarElevation(noon, LAT, LON)).toBeCloseTo(90 - LAT - 16.4, 0);
    expect(solarElevation(noon + 12 * 3600, LAT, LON)).toBeLessThan(-60);
  });
});

describe('intervalMeans', () => {
  const t = Array.from({ length: 30 }, (_, i) => i * 60);
  it('averages 1-min bins inside each interval', () => {
    const y = t.map((s) => s / 60);
    expect(intervalMeans(t, y, [0, 900], 900)).toEqual([7, 22]);
  });
  it('drops intervals with less than 80 % coverage', () => {
    const y = t.map((s, i) => (i < 15 && i % 4 === 0 ? null : 1));
    expect(intervalMeans(t, y, [0, 900], 900)).toEqual([null, 1]);
  });
});

describe('precipitation', () => {
  it('turns a since-midnight accumulation into increments across the reset', () => {
    const inc = accumIncrements([0, 0.2, null, 0.5, 0.1, 0.3]);
    expect(cumsum(inc).at(-1)).toBeCloseTo(0.5 + 0.3);
  });
});

describe('score', () => {
  it('computes bias as model minus observed', () => {
    expect(score([100, 200, null], [110, 180, 5])).toEqual({ n: 2, bias: -5, rmse: Math.sqrt((100 + 400) / 2), obsMean: 150 });
    expect(score([null], [1])).toBeNull();
  });
});

describe('compare', () => {
  // Observations equal to the model's own interval means: a perfect forecast.
  const to = model.t[0] + 36 * 3600;
  const t = Array.from({ length: 1440 }, (_, i) => to - 86_400 + i * 60);
  const at = (s: number) => model.ghi[model.t.findIndex((m) => m <= s && s < m + 900)] ?? null;
  const c = compare({ ghi: { t, y: t.map(at) }, accum: { t, y: t.map(() => 0) } }, model, LAT, LON)!;

  it('scores only daytime intervals inside the 24 h window', () => {
    expect(c.to - c.from).toBe(86_400);
    expect(c.ghi.score!.n).toBeGreaterThan(30);
    expect(c.ghi.score!.n).toBeLessThan(48);
    expect(c.ghi.score!.bias).toBeCloseTo(0);
    expect(c.ghi.score!.rmse).toBeCloseTo(0);
  });

  it('reports equal insolation in MJ m⁻² for a perfect forecast', () => {
    expect(c.ghi.obsMJ).toBeGreaterThan(5);
    expect(c.ghi.obsMJ).toBeCloseTo(c.ghi.modelMJ!, 6);
    expect(c.precip).toEqual({ obs: 0, model: 0 });
  });

  it('returns null without observations', () => {
    expect(compare({}, model, LAT, LON)).toBeNull();
  });
});

describe('day-ahead', () => {
  const d = normalizeDayAhead(day1, model.t);

  it('aligns the previous-day values on the latest series by interval start', () => {
    expect(d.ghi).toHaveLength(model.t.length);
    const raw = day1.minutely_15;
    const k = raw.shortwave_radiation_previous_day1.findIndex((v: number) => v > 300);
    const i = model.t.indexOf(raw.time[k] - 900);
    expect(d.ghi[i]).toBe(raw.shortwave_radiation_previous_day1[k]);
    // The fixture ends a day before the latest series does.
    expect(d.ghi.at(-1)).toBeNull();
  });

  it('uses day-ahead values up to the window end and the latest run after it', () => {
    const to = model.t[120];
    const mixed = withLead({ ...model, dayAhead: d }, 'day', to)!;
    expect(mixed.ghi.slice(0, 119)).toEqual(d.ghi.slice(0, 119));
    expect(mixed.ghi.slice(120)).toEqual(model.ghi.slice(120));
    expect(withLead({ ...model, dayAhead: null }, 'day', to)).toBeNull();
    expect(withLead(model, 'short', to)).toBe(model);
  });

  it('finds the window end from the latest observation', () => {
    expect(windowEnd({ ghi: { t: [0, 60], y: [1, 1] }, accum: { t: [0, 120], y: [0, 0] } })).toBe(180);
    expect(windowEnd({})).toBeNull();
  });
});

describe('renderScores', () => {
  const to = model.t[0] + 36 * 3600;
  const t = Array.from({ length: 1440 }, (_, i) => to - 86_400 + i * 60);
  const c = compare({ ghi: { t, y: t.map(() => 100) } }, model, LAT, LON);

  it('lays out one column per lead and dashes a missing lead', () => {
    const html = renderScores([{ label: 'Short-range', c }, { label: 'Day-ahead <b>', c: null }], 'si');
    expect(html.match(/<th scope="col">/g)).toHaveLength(4);
    expect(html).toContain('Day-ahead &lt;b&gt;');
    expect(html).toContain('100 <span class="muted">mean</span>');
    expect(html).toContain('(mm)');
    expect(renderScores([{ label: 'x', c: null }], 'si')).toBe('');
  });
});
