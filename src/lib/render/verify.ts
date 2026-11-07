/**
 * Summary statistics for the forecast-versus-observed comparison, as an HTML definition list.
 * Irradiance stays in W m⁻² and MJ m⁻² in both unit systems; precipitation follows the toggle.
 */
import { precip, type UnitSystem } from '../units.ts';
import type { Comparison, Score } from '../verify.ts';

const W = 'W m⁻²';
const signed = (x: number, d = 0) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;

const scoreText = (s: Score | null) =>
  s
    ? `HRRR bias ${signed(s.bias)} ${W}, RMSE ${s.rmse.toFixed(0)} ${W}, against an observed mean of ${s.obsMean.toFixed(0)} ${W} (${s.n} intervals).`
    : 'Not enough daytime observations in the last 24 hours.';

export function renderScores(c: Comparison, u: UnitSystem): string {
  const { obsMJ, modelMJ } = c.ghi;
  const insolation =
    obsMJ != null && modelMJ != null
      ? `Observed ${obsMJ.toFixed(1)} MJ m⁻², HRRR ${modelMJ.toFixed(1)} MJ m⁻²${obsMJ > 0.5 ? ` (${signed(((modelMJ - obsMJ) / obsMJ) * 100)} %)` : ''}.`
      : 'Not available: the observations cover less than 90 % of the last 24 hours.';
  const rows: [string, string][] = [
    ['Sunlight', scoreText(c.ghi.score)],
    ['Diffuse sunlight', scoreText(c.diffuse.score)],
    ['Total solar energy', insolation],
    ['Precipitation', `Observed ${precip(c.precip.obs, u)}, HRRR ${precip(c.precip.model, u)}.`],
  ];
  return rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
