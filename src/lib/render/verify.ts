/**
 * Summary statistics for the forecast-versus-observed comparison: one table, one column per
 * forecast lead time. Irradiance stays in W m⁻² and MJ m⁻² in both unit systems;
 * precipitation follows the unit toggle.
 */
import { esc } from './forecast.ts';
import { precip, precipUnit, type UnitSystem } from '../units.ts';
import type { Comparison, Score } from '../verify.ts';

const signed = (x: number, d = 0) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;
const NA = '<span class="muted">–</span>';

const errCell = (s: Score | null) => (s ? `${signed(s.bias)} / ${s.rmse.toFixed(0)}` : NA);

const energyCell = (c: Comparison, obs: number | null) => {
  const m = c.ghi.modelMJ;
  if (m == null) return NA;
  return `${m.toFixed(1)}${obs != null && obs > 0.5 ? ` <span class="muted">(${signed(((m - obs) / obs) * 100)} %)</span>` : ''}`;
};

/**
 * `leads[0]` supplies the observed column. A lead whose comparison is null (e.g. day-ahead
 * values unavailable) shows dashes.
 */
export function renderScores(leads: { label: string; c: Comparison | null }[], u: UnitSystem): string {
  const ref = leads.find((l) => l.c)?.c;
  if (!ref) return '';
  const head = `<tr><th scope="col"><span class="visually-hidden">Quantity</span></th><th scope="col">Observed</th>${leads.map((l) => `<th scope="col">${esc(l.label)}</th>`).join('')}</tr>`;
  const row = (label: string, obs: string, cell: (c: Comparison) => string) =>
    `<tr><th scope="row">${label}</th><td>${obs}</td>${leads.map((l) => `<td>${l.c ? cell(l.c) : NA}</td>`).join('')}</tr>`;
  const mean = (s: Score | null) => (s ? `${s.obsMean.toFixed(0)} <span class="muted">mean</span>` : NA);
  const obsMJ = ref.ghi.obsMJ;
  return `<table class="fvo-table">
  <thead>${head}</thead>
  <tbody>
    ${row('Sunlight, bias / RMSE <span class="unit">(W m⁻²)</span>', mean(ref.ghi.score), (c) => errCell(c.ghi.score))}
    ${row('Diffuse sunlight, bias / RMSE <span class="unit">(W m⁻²)</span>', mean(ref.diffuse.score), (c) => errCell(c.diffuse.score))}
    ${row('Total solar energy <span class="unit">(MJ m⁻²)</span>', obsMJ == null ? NA : obsMJ.toFixed(1), (c) => energyCell(c, obsMJ))}
    ${row(`Precipitation <span class="unit">(${precipUnit(u)})</span>`, precip(ref.precip.obs, u).split(' ')[0], (c) => precip(c.precip.model, u).split(' ')[0])}
  </tbody>
</table>`;
}
