import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { binSeries, denverDate, parseDat } from '../src/lib/dat.ts';
import { parseEvents, parsePlotImages, parseStatus } from '../src/lib/legacy.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const iso = (t: number) => new Date(t * 1000).toISOString();

describe('parseDat', () => {
  it('reads the local date and rolls the UTC date at midnight (tab-delimited)', () => {
    const { localDate, t, cols } = parseDat(fx('pyra.dat'), [1]);
    expect(localDate).toBe('2026-10-30');
    expect(iso(t[0])).toBe('2026-10-30T06:00:03.000Z'); // local midnight, MDT = UTC-6
    const wrap = t.findIndex((x, i) => i > 0 && x - t[i - 1] < 0);
    expect(wrap).toBe(-1); // times stay monotonic across UTC midnight
    expect(iso(t.at(-1)!)).toMatch(/^2026-10-31T00:/);
    expect(cols[0][0]).toBeCloseTo(18.053003);
  });

  it('handles the SPN1 comma-delimited format and "start time =" header', () => {
    const { localDate, t, cols } = parseDat(fx('spn.dat'), [1, 2]);
    expect(localDate).toBe('2026-10-30');
    expect(iso(t[0])).toBe('2026-10-30T11:30:45.000Z');
    expect(cols[0][0]).toBe(1.3);
    expect(cols[1][0]).toBe(0);
  });

  it('reads wide multi-column files (net radiometer)', () => {
    const { cols } = parseDat(fx('netrad.dat'), [1, 3, 7, 9]);
    expect(cols.map((c) => c[0])).toEqual([1, 3, 304, 348]);
  });

  it('throws without a date header', () => {
    expect(() => parseDat('00:00:01\t1\n', [1])).toThrow(/no local date/);
  });
});

describe('binSeries', () => {
  it('averages within bins, skips NaN, and supports last-value reduction', () => {
    const t = [0, 10, 20, 65, 70];
    const out = binSeries(t, [[1, 2, Number.NaN, 5, 7], [1, 2, 3, 4, 5]], ['mean', 'last'], 60);
    expect(out.t).toEqual([0, 60]);
    expect(out.cols[0]).toEqual([1.5, 6]);
    expect(out.cols[1]).toEqual([3, 5]);
  });

  it('yields null for an all-missing bin', () => {
    const out = binSeries([0], [[Number.NaN]], ['mean']);
    expect(out.cols[0]).toEqual([null]);
  });
});

describe('denverDate', () => {
  it('uses the Mountain calendar day, not UTC', () => {
    // 00:46 UTC on 31 Oct is still 30 Oct in Boulder.
    expect(denverDate(new Date('2026-10-31T00:46:00Z'))).toEqual({ yy: '26', mm: '10', dd: '30' });
    expect(denverDate(new Date('2026-10-31T00:46:00Z'), -1)).toEqual({ yy: '26', mm: '10', dd: '29' });
  });
});

describe('legacy HTML scrapers', () => {
  it('parses the homepage status table', () => {
    const s = parseStatus(fx('legacy-home.html'));
    expect(s).toMatchObject({
      swDown: 49,
      lwDown: 282,
      swDiffuse: 47,
      dailyPrecip: 0,
      rainRate: 0,
      snowDepth: 0,
      ozone: 40,
      cloud: 'No Cloud Base Detected',
      observedAt: '2026-10-30T23:02:00.000Z',
    });
  });

  it('extracts unquoted plot <img> sources as absolute URLs', () => {
    const imgs = parsePlotImages(fx('mrr.html'));
    expect(imgs).toHaveLength(4);
    expect(imgs[0].src).toMatch(/^https:\/\/skywatch\.colorado\.edu\/data\/mrr\/mrr_avg_Fallvelocity_\d{2}_\d{2}_\d{2}\.png$/);
    expect(imgs[0].alt).toContain('Fall Velocity');
    expect(parsePlotImages(fx('pyra.html'))).toHaveLength(1);
  });

  it('lists unique special-event images', () => {
    const ev = parseEvents(fx('event.html'));
    const soundings = ev.filter((e) => e.kind === 'sounding');
    expect(soundings.length).toBe(29);
    expect(ev.some((e) => e.kind === 'case')).toBe(true);
    expect(soundings[0].src).toBe('https://skywatch.colorado.edu/data/sounding/sound_2018_10_26.png');
  });
});
