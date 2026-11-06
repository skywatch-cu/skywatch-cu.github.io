import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeAlerts, normalizeForecast, parseDiscussion, parseWind, textBlocks } from '../src/lib/providers/nws.ts';
import { esc, pairDays, renderAlerts, renderOutlook, renderWeek } from '../src/lib/render/forecast.ts';
import { temp, wind } from '../src/lib/units.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/nws/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fx(name));

describe('normalizeForecast', () => {
  const f = normalizeForecast(json('forecast.json'));

  it('converts the 12-hour periods to SI', () => {
    expect(f.updated).toBe('2026-11-04T18:47:03+00:00');
    expect(f.periods).toHaveLength(14);
    expect(f.periods[0].name).toBe('This Afternoon');
    expect(f.periods[0].tempC).toBeCloseTo((56 - 32) / 1.8); // 56 °F
    expect(f.periods[0].pop).toBe(9);
    expect(f.periods[2].windMs![0]).toBeCloseTo(0.44704);
    expect(f.periods[2].windMs![1]).toBeCloseTo(5 * 0.44704);
  });

  it('round-trips °F for display without drift', () => {
    expect(f.periods.map((p) => temp(p.tempC, 'us'))).toEqual(
      [56, 35, 59, 35, 56, 33, 60, 34, 65, 39, 67, 39, 63, 40].map((t) => `${t}°`),
    );
  });

  it('keeps dew point and humidity from the hourly product', () => {
    const h = normalizeForecast(json('hourly.json'));
    expect(h.periods[0].dewpointC).toBeCloseTo(1.667, 2);
    expect(h.periods[0].relHumidity).toBe(48);
  });
});

describe('parseWind and wind()', () => {
  it('parses single values, ranges and km/h', () => {
    expect(parseWind('10 to 15 mph')!.map((v) => +v.toFixed(2))).toEqual([4.47, 6.71]);
    expect(parseWind('36 km/h')![0]).toBeCloseTo(10);
    expect(parseWind('')).toBeNull();
  });
  it('formats in either unit system', () => {
    expect(wind(parseWind('10 to 15 mph'), 'NW', 'us')).toBe('NW 10–15 mph');
    expect(wind(parseWind('5 mph'), 'NE', 'si')).toBe('NE 2 m s⁻¹');
  });
});

describe('pairDays and renderWeek', () => {
  const f = normalizeForecast(json('forecast.json'));

  it('pairs each day with the following night', () => {
    const days = pairDays(f.periods);
    expect(days).toHaveLength(7);
    expect(days[0].day?.name).toBe('This Afternoon');
    expect(days[0].night?.name).toBe('Tonight');
    expect(days[6].night?.name).toBe('Tuesday Night');
  });

  it('starts with a lone night when the forecast is issued in the evening', () => {
    const days = pairDays(f.periods.slice(1));
    expect(days[0]).toEqual({ name: 'Tonight', night: f.periods[1] });
    expect(days[1].day?.name).toBe('Thursday');
  });

  it('draws every bar inside its track', () => {
    const html = renderWeek(f.periods, 'us');
    expect(html).not.toMatch(/NaN|Infinity/);
    for (const m of html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)) {
      expect(+m[1] + +m[2]).toBeLessThanOrEqual(100.05);
    }
  });
});

describe('alerts', () => {
  const alerts = normalizeAlerts(json('alerts.json'));

  it('normalizes and sorts by severity', () => {
    expect(alerts[0].event).toBe('Winter Weather Advisory');
    expect(alerts[0].severity).toBe('Moderate');
    const mixed = normalizeAlerts({
      features: [{ properties: { id: 'a', event: 'Minor', severity: 'Minor' } }, { properties: { id: 'b', event: 'Big', severity: 'Extreme' } }],
    });
    expect(mixed.map((a) => a.event)).toEqual(['Big', 'Minor']);
  });

  it('escapes API text', () => {
    const html = renderAlerts([{ ...alerts[0], event: '<img src=x onerror=alert(1)>' }], true);
    expect(html).not.toContain('<img');
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});

describe('parseDiscussion', () => {
  const d = parseDiscussion(fx('afd.txt'), '2026-11-04T17:41:00+00:00', 'BOU');

  it('splits the dotted sections, including notes before the dots', () => {
    expect(d.sections.map((s) => s.title)).toEqual(['KEY MESSAGES', 'DISCUSSION', 'AVIATION', 'BOU WATCHES/WARNINGS/ADVISORIES']);
    expect(d.sections[1].note).toBe('Through Tuesday');
    expect(d.sections[1].body).toMatch(/^Issued at 1123 PM MST/);
    expect(d.sections.every((s) => !s.body.includes('&&') && !s.body.includes('$$'))).toBe(true);
  });

  it('turns the key messages into one list and rejoins wrapped lines', () => {
    const blocks = textBlocks(d.sections[0].body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('ul');
    const items = (blocks[0] as { items: string[] }).items;
    expect(items).toHaveLength(4);
    expect(items[0]).toMatch(/^Precipitation will form across the mountains and foothills along and south/);
  });
});

it('renderOutlook labels highs and lows', () => {
  const html = renderOutlook(normalizeForecast(json('forecast.json')).periods, 'si');
  expect(html.match(/<li/g)).toHaveLength(3);
  expect(html).toContain('High</span> 13°');
  expect(html).toContain('Low</span> 2°');
});
