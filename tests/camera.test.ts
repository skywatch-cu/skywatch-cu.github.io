import { describe, expect, it } from 'vitest';
import { bucket, camSrcset, proxied } from '../src/lib/camera.ts';

const SRC = 'https://skywatch.colorado.edu/data/skycam/fixed.jpg';

describe('camera sources', () => {
  it('puts the cache key inside the proxied source URL', () => {
    const u = new URL(proxied(SRC, 800, '42'));
    expect(u.origin).toBe('https://wsrv.nl');
    expect(u.searchParams.get('url')).toBe(`${SRC}?t=42`);
    expect(u.searchParams.get('w')).toBe('800');
  });

  it('changes the key once per 2-minute interval', () => {
    expect(bucket(0)).toBe(bucket(119_999));
    expect(bucket(120_000)).not.toBe(bucket(119_999));
  });

  it('lists resized copies, then the original, without commas inside URLs', () => {
    const set = camSrcset(SRC, 3840, '7').split(', ');
    expect(set.map((c) => c.split(' ')[1])).toEqual(['800w', '1600w', '3840w']);
    expect(set[2]).toBe(`${SRC} 3840w`);
    expect(camSrcset(SRC, 3840, '7', true).split(', ')[2]).toBe(`${SRC}?t=7 3840w`);
  });

  it('skips copies at least as wide as the original', () => {
    expect(camSrcset(SRC, 1000, '1').split(', ')).toHaveLength(2);
  });
});
