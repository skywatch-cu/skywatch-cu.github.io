/**
 * Scrapers for HTML published by the legacy server (skywatch.colorado.edu).
 * They run at build time only: the legacy server sends no CORS headers.
 */

export const LEGACY_ORIGIN = 'https://skywatch.colorado.edu';

export interface Status {
  /** ISO-8601 UTC time the legacy homepage reports for its readings. */
  observedAt: string | null;
  swDown: number | null; // W m-2, Kipp & Zonen CMP3
  lwDown: number | null; // W m-2, Kipp & Zonen CGR3
  swDiffuse: number | null; // W m-2, SPN1 diffuse
  dailyPrecip: number | null; // mm since local midnight
  rainRate: number | null; // mm h-1
  snowDepth: number | null; // mm
  ozone: number | null; // ppb
  cloud: string | null; // e.g. "No Cloud Base Detected"
}

export interface PlotImage {
  src: string;
  alt: string;
}

const num = (html: string, label: string): number | null => {
  const m = new RegExp(`${label}:\\s*(-?[\\d.]+)`).exec(html);
  return m ? Number(m[1]) : null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse the status table on the legacy homepage. */
export function parseStatus(html: string): Status {
  const when = /(\d{2}):(\d{2})\s+([A-Z][a-z]{2})-(\d{2})-(\d{4})\s+UTC/.exec(html);
  let observedAt: string | null = null;
  if (when) {
    const month = MONTHS.indexOf(when[3]);
    if (month >= 0) {
      observedAt = new Date(
        Date.UTC(Number(when[5]), month, Number(when[4]), Number(when[1]), Number(when[2])),
      ).toISOString();
    }
  }
  const cloud = /UTC\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>/.exec(html);
  return {
    observedAt,
    swDown: num(html, 'Pyranometer'),
    lwDown: num(html, 'Pyrgeometer'),
    swDiffuse: num(html, 'Pyra Diffuse'),
    dailyPrecip: num(html, 'Daily Precip'),
    rainRate: num(html, 'Rain Intensity'),
    snowDepth: num(html, 'Snow Depth'),
    ozone: num(html, 'Ozone'),
    cloud: cloud ? cloud[1] : null,
  };
}

/** Today's plot images on a legacy `php/<page>.php` page, as absolute URLs. */
export function parsePlotImages(html: string): PlotImage[] {
  const out: PlotImage[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*"?([^"\s>]+)"?/i.exec(tag)?.[1];
    if (!src || !/\/data\//.test(src)) continue; // skip logos and nav art
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    out.push({ src: new URL(src, `${LEGACY_ORIGIN}/php/`).href, alt });
  }
  return out;
}

export interface EventImage {
  label: string;
  src: string;
  kind: 'sounding' | 'case';
}

/** Special-event products (radiosonde soundings, case studies) listed on `php/event.php`. */
export function parseEvents(html: string): EventImage[] {
  const out: EventImage[] = [];
  for (const m of html.matchAll(/"((?:\.\.\\\/)?data\\?\/(sounding|sp_cases)\\?\/([\w]+)\.png)"/g)) {
    const path = m[1].replaceAll('\\/', '/').replace(/^\.\.\//, '');
    out.push({
      label: m[3],
      src: `${LEGACY_ORIGIN}/${path}`,
      kind: m[2] === 'sounding' ? 'sounding' : 'case',
    });
  }
  // The page repeats the list in its <option> tags and a JS array; keep unique entries.
  return [...new Map(out.map((e) => [e.src, e])).values()];
}
