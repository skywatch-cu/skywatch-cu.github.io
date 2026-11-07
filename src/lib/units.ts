/**
 * Display units for forecast quantities. Data are stored in SI; the visitor's choice
 * (US: °F, mph, in; SI: °C, m s⁻¹, mm) is remembered in localStorage and broadcast as `unitchange`.
 */
export type UnitSystem = 'us' | 'si';

export const temp = (c: number | null, u: UnitSystem) =>
  c == null ? '–' : u === 'us' ? `${Math.round((c * 9) / 5 + 32)}°` : `${Math.round(c)}°`;
export const tempValue = (c: number, u: UnitSystem) => (u === 'us' ? (c * 9) / 5 + 32 : c);
export const tempUnit = (u: UnitSystem) => (u === 'us' ? '°F' : '°C');

export function wind(ms: [number, number] | null, dir: string, u: UnitSystem): string {
  if (!ms) return '';
  const k = u === 'us' ? 1 / 0.44704 : 1;
  const [a, b] = ms.map((v) => Math.round(v * k));
  const unit = u === 'us' ? 'mph' : 'm s⁻¹';
  return `${dir ? `${dir} ` : ''}${a === b ? a : `${a}–${b}`} ${unit}`;
}

/** Precipitation depth: inches to two decimals, or millimetres to one. */
export const precip = (mm: number | null, u: UnitSystem) =>
  mm == null ? '–' : u === 'us' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
export const precipValue = (mm: number, u: UnitSystem) => (u === 'us' ? mm / 25.4 : mm);
export const precipUnit = (u: UnitSystem) => (u === 'us' ? 'in' : 'mm');

const KEY = 'units';

export function getUnits(): UnitSystem {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'us' || v === 'si') return v;
  } catch {}
  return 'us'; // NWS forecast text quotes °F and mph; keep the numbers consistent with it by default
}

export function setUnits(u: UnitSystem) {
  try {
    localStorage.setItem(KEY, u);
  } catch {}
  window.dispatchEvent(new CustomEvent('unitchange', { detail: u }));
}
