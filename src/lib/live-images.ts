/**
 * Reload stable-URL camera images (`img[data-live]`) every 2 min while the tab is visible,
 * as the legacy page did. Imported by each camera component; the module runs once per page.
 */
const imgs = document.querySelectorAll<HTMLImageElement>('img[data-live]');
const base = new Map([...imgs].map((i) => [i, i.src]));
setInterval(() => {
  if (document.hidden) return;
  for (const [img, src] of base) img.src = `${src}?t=${Date.now()}`;
}, 120_000);
