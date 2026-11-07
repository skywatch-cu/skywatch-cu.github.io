/**
 * Reload stable-URL camera images (`img[data-live]`) every 2 min while the tab is visible,
 * as the legacy page did. Imported by each camera component; the module runs once per page.
 * Images with `data-full-width` carry a resized `srcset` (see camera.ts).
 */
import { bucket, camSrcset, REFRESH_MS } from './camera.ts';

const imgs = document.querySelectorAll<HTMLImageElement>('img[data-live]');
const base = new Map([...imgs].map((i) => [i, i.src]));

function refresh(img: HTMLImageElement, src: string, first: boolean) {
  const full = Number(img.dataset.fullWidth);
  // The build-time srcset carries the build's cache key; on load, point the small copies at the current one.
  if (full && img.srcset) img.srcset = camSrcset(src, full, bucket(), !first);
  else if (!first) img.src = `${src}?t=${Date.now()}`;
}

for (const [img, src] of base) {
  // Proxy unreachable or refusing the source: drop the resized copies and load the original.
  img.addEventListener('error', () => {
    if (img.srcset) {
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
    }
  });
  refresh(img, src, true);
}

setInterval(() => {
  if (document.hidden) return;
  for (const [img, src] of base) refresh(img, src, false);
}, REFRESH_MS);
