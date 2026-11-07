/**
 * Responsive sources for the live camera images. The legacy server publishes only full-size
 * frames (the sky camera is 3840 × 2160, ≈600 KB), so smaller copies come from wsrv.nl, an
 * open-source resizing proxy. If the proxy fails, live-images.ts falls back to the original.
 */
const PROXY = 'https://wsrv.nl/';
export const PROXY_WIDTHS = [800, 1600];
/** Refresh interval of the camera images, ms. */
export const REFRESH_MS = 120_000;

/**
 * Cache-busting key that changes once per refresh interval. wsrv.nl caches a source URL for
 * up to a year, so the key goes into the source URL; sharing it across visitors within an
 * interval lets them hit the same cached copy.
 */
export const bucket = (ms = Date.now()) => String(Math.floor(ms / REFRESH_MS));

export const proxied = (src: string, w: number, t: string) =>
  `${PROXY}?url=${encodeURIComponent(`${src}?t=${t}`)}&w=${w}&q=75`;

/**
 * `srcset` with resized copies plus the original at `fullWidth`. The original is busted only
 * when `bustFull` is set, so refreshing the small copies on page load doesn't make wide
 * screens download the full frame twice.
 */
export const camSrcset = (src: string, fullWidth: number, t: string, bustFull = false) =>
  [
    ...PROXY_WIDTHS.filter((w) => w < fullWidth).map((w) => `${proxied(src, w, t)} ${w}w`),
    `${bustFull ? `${src}?t=${t}` : src} ${fullWidth}w`,
  ].join(', ');
