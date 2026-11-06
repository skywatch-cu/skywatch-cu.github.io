/**
 * HTML renderers for forecast data. The same functions produce the build-time markup
 * (via Astro `set:html`) and the live re-render in the browser, so both always agree.
 * All text from the API is escaped.
 */
import type { Alert, Discussion, ForecastPeriod } from '../providers/nws.ts';
import { textBlocks } from '../providers/nws.ts';
import { temp, wind, type UnitSystem } from '../units.ts';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const TZ = 'America/Denver';
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dayName = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' });

const pop = (p: number | null) => (p ? `<span class="pop" title="Chance of precipitation">${p}%</span>` : '');

/** The next few 12-hour periods, as compact cards. */
export function renderOutlook(periods: ForecastPeriod[], u: UnitSystem, n = 3): string {
  return periods
    .slice(0, n)
    .map(
      (p) => `<li class="ol">
  <span class="ol-name">${esc(p.name)}</span>
  <span class="ol-temp"><span class="ol-hl">${p.isDaytime ? 'High' : 'Low'}</span> ${temp(p.tempC, u)}</span>
  <span class="ol-short">${esc(p.short)}</span>
  <span class="ol-meta">${pop(p.pop)} ${esc(wind(p.windMs, p.windDir, u))}</span>
</li>`,
    )
    .join('');
}

interface Day {
  name: string;
  day?: ForecastPeriod;
  night?: ForecastPeriod;
}

/** Pair each daytime period with the night that follows; a leading "Tonight" stands alone. */
export function pairDays(periods: ForecastPeriod[]): Day[] {
  const days: Day[] = [];
  for (const p of periods) {
    const last = days[days.length - 1];
    if (!p.isDaytime && last?.day && !last.night) last.night = p;
    else days.push(p.isDaytime ? { name: p.name, day: p } : { name: p.name, night: p });
  }
  return days;
}

/**
 * Seven-day table. Each row draws its low–high range on a scale shared by the whole week,
 * so warm and cold spells read at a glance.
 */
export function renderWeek(periods: ForecastPeriod[], u: UnitSystem): string {
  const days = pairDays(periods);
  const ts = periods.map((p) => p.tempC).filter((t): t is number => t != null);
  const lo = Math.min(...ts);
  const span = Math.max(1, Math.max(...ts) - lo);
  const pct = (c: number) => ((c - lo) / span) * 100;
  /** Bar from l% to r% of the track. The cold-to-warm gradient is sized to the whole track,
   * so a bar's colour reflects its absolute temperature, not just its own range. */
  const bar = (l: number, r: number) => {
    const w = Math.max(2, r - l);
    l = Math.min(l, 100 - w);
    const x = w >= 100 ? 0 : (l / (100 - w)) * 100;
    return `left:${l.toFixed(1)}%;width:${w.toFixed(1)}%;background-size:${((100 / w) * 100).toFixed(0)}% 100%;background-position-x:${x.toFixed(1)}%`;
  };
  return days
    .map((d) => {
      const main = d.day ?? d.night!;
      const hi = d.day?.tempC ?? null;
      const lw = d.night?.tempC ?? null;
      const a = lw ?? hi!;
      const b = hi ?? lw!;
      const name = d.day ? (/^(Today|This )/.test(d.name) ? d.name : dayName(d.day.start)) : d.name;
      const detail = [d.day, d.night]
        .filter((p): p is ForecastPeriod => !!p)
        .map((p) => `<p><strong>${esc(p.name)}.</strong> ${esc(p.detailed)}</p>`)
        .join('');
      return `<li class="wk">
  <details>
    <summary>
      <span class="wk-name">${esc(name)}</span>
      <span class="wk-short">${esc(main.short)} ${pop(Math.max(d.day?.pop ?? 0, d.night?.pop ?? 0))}</span>
      <span class="wk-lo">${lw == null ? '' : temp(lw, u)}</span>
      <span class="wk-bar" aria-hidden="true"><span style="${bar(pct(Math.min(a, b)), pct(Math.max(a, b)))}"></span></span>
      <span class="wk-hi">${hi == null ? '' : temp(hi, u)}</span>
    </summary>
    <div class="wk-detail">${detail}</div>
  </details>
</li>`;
    })
    .join('');
}

const SEV_CLASS: Record<Alert['severity'], string> = {
  Extreme: 'sev-high',
  Severe: 'sev-high',
  Moderate: 'sev-mid',
  Minor: 'sev-low',
  Unknown: 'sev-low',
};

export function renderAlerts(alerts: Alert[], full: boolean): string {
  return alerts
    .map((a) => {
      const when = [a.onset && `from ${fmtTime(a.onset)}`, a.ends && `until ${fmtTime(a.ends)}`].filter(Boolean).join(' ');
      const body = full
        ? `<details><summary>Details</summary>${textBlocks(a.description)
            .map((b) => (b.kind === 'p' ? `<p>${esc(b.text)}</p>` : `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`))
            .join('')}${a.instruction ? `<p><strong>What to do:</strong> ${esc(a.instruction.replace(/\s*\n\s*/g, ' '))}</p>` : ''}</details>`
        : '';
      return `<div class="alert ${SEV_CLASS[a.severity]}" role="status">
  <p><strong>${esc(a.event)}</strong> <span class="alert-when">${esc(when)}</span></p>
  ${full ? `<p class="alert-sender">${esc(a.sender)}</p>` : ''}
  ${body}
</div>`;
    })
    .join('');
}

const OPEN = new Set(['KEY MESSAGES', 'DISCUSSION', 'SHORT TERM', 'LONG TERM']);

export function renderDiscussion(d: Discussion): string {
  return d.sections
    .filter((s) => s.body)
    .map((s) => {
      const title = s.title.charAt(0) + s.title.slice(1).toLowerCase();
      const note = s.note;
      const body = textBlocks(s.body)
        .map((b) => (b.kind === 'p' ? `<p>${esc(b.text)}</p>` : `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`))
        .join('');
      const open = [...OPEN].some((k) => s.title.startsWith(k));
      return `<details class="afd-sec"${open ? ' open' : ''}>
  <summary><h3>${esc(title)}</h3>${note ? ` <span class="muted small">${esc(note)}</span>` : ''}</summary>
  ${body}
</details>`;
    })
    .join('');
}
