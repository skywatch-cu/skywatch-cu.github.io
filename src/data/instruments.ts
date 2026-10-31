/**
 * Single source of truth for the instrument suite. Used by the build-time fetcher
 * (scripts/fetch-data.ts) and by every page. Keep this module free of Astro imports.
 */
import type { Reducer } from '../lib/dat.ts';

export type Category = 'radiation' | 'clouds' | 'precipitation' | 'chemistry';

export const CATEGORY_LABEL: Record<Category, string> = {
  radiation: 'Radiation',
  clouds: 'Clouds and aerosol',
  precipitation: 'Precipitation',
  chemistry: 'Trace gases',
};

export interface FieldSpec {
  key: string;
  /** Column index in the .dat row (0 = UTC time). */
  col: number;
  label: string;
  unit: string;
  /** CSS custom property holding the series colour, so it adapts to dark mode. */
  color: string;
  reducer: Reducer;
  /** Multiplier applied before binning (unit conversion). */
  scale?: number;
  /** Treat exact zeros as "no detection" (ceilometer cloud base). */
  zeroIsNull?: boolean;
}

export interface DerivedField {
  key: string;
  label: string;
  unit: string;
  color: string;
  from: (v: Record<string, number | null>) => number | null;
}

export interface SeriesSpec {
  /** Directory under /data/ on the legacy server. */
  dir: string;
  /** File prefix: <dir>/<prefix>_YY_MM_DD.dat */
  prefix: string;
  /** Native logging interval, s. */
  intervalSec: number;
  fields: FieldSpec[];
  derived?: DerivedField[];
}

export interface Instrument {
  id: string;
  name: string;
  model: string;
  category: Category;
  /** One-paragraph plain description of what is measured and how. */
  measures: string;
  /** Legacy php page (without .php) holding today's server-rendered plots. */
  legacyPage?: string;
  /** Codes understood by the legacy archive (php/data.php?instrument=...). */
  archive: { code: string; label: string }[];
  specUrl?: string;
  series?: SeriesSpec;
  note?: string;
}

const W = 'W m⁻²';

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'pyranometer',
    name: 'Pyranometer',
    model: 'Kipp & Zonen CMP 3',
    category: 'radiation',
    measures:
      'Global (direct plus diffuse) shortwave irradiance on a horizontal surface, 0.3–2.8 µm: the sunlight that reaches the ground after transmission through the atmosphere.',
    legacyPage: 'pyra',
    archive: [{ code: 'pyra', label: 'Pyranometer' }],
    specUrl: 'https://www.kippzonen.com/?product/1131/CMP+3.aspx',
    series: {
      dir: 'pyranometer',
      prefix: 'pyra',
      intervalSec: 10,
      fields: [{ key: 'sw_down', col: 1, label: 'Shortwave down', unit: W, color: '--c-sw', reducer: 'mean' }],
    },
  },
  {
    id: 'pyrgeometer',
    name: 'Pyrgeometer',
    model: 'Kipp & Zonen CGR 3',
    category: 'radiation',
    measures:
      'Downwelling broadband longwave (thermal infrared) irradiance, 4.5–42 µm, emitted by the atmosphere and clouds overhead.',
    legacyPage: 'pyrg',
    archive: [{ code: 'pyrg', label: 'Pyrgeometer' }],
    specUrl: 'https://www.kippzonen.com/?product/16132/CGR+3.aspx',
    series: {
      dir: 'pyrgeometer',
      prefix: 'pyrg',
      intervalSec: 10,
      fields: [
        { key: 'lw_down', col: 1, label: 'Longwave down', unit: W, color: '--c-lw', reducer: 'mean' },
        { key: 't_body', col: 3, label: 'Sensor body temperature', unit: 'K', color: '--c-muted', reducer: 'mean' },
      ],
    },
  },
  {
    id: 'spn1',
    name: 'Total and diffuse pyranometer',
    model: 'Delta-T Devices SPN1',
    category: 'radiation',
    measures:
      'Total and diffuse shortwave irradiance from seven thermopile sensors under a patterned shade, with no moving parts or sun tracker. The direct-beam component follows as total minus diffuse.',
    legacyPage: 'spn',
    archive: [{ code: 'spn', label: 'Total/diffuse pyranometer' }],
    specUrl: 'https://delta-t.co.uk/product/spn1/',
    series: {
      dir: 'spn',
      prefix: 'spn',
      intervalSec: 5,
      fields: [
        { key: 'sw_total', col: 1, label: 'Total', unit: W, color: '--c-sw', reducer: 'mean' },
        { key: 'sw_diffuse', col: 2, label: 'Diffuse', unit: W, color: '--c-diffuse', reducer: 'mean' },
      ],
    },
  },
  {
    id: 'net-radiometer',
    name: 'Net radiometer',
    model: 'Four-component net radiometer',
    category: 'radiation',
    measures:
      'Upward- and downward-facing pyranometer and pyrgeometer pairs. Together they close the surface radiation budget: net irradiance is (SW↓ − SW↑) + (LW↓ − LW↑).',
    legacyPage: 'netrad',
    archive: [{ code: 'netrad', label: 'Net radiometer' }],
    series: {
      dir: 'netrad',
      prefix: 'netrad',
      intervalSec: 10,
      fields: [
        { key: 'sw_down', col: 1, label: 'SW down', unit: W, color: '--c-sw', reducer: 'mean' },
        { key: 'sw_up', col: 3, label: 'SW up', unit: W, color: '--c-diffuse', reducer: 'mean' },
        { key: 'lw_down', col: 7, label: 'LW down', unit: W, color: '--c-lw', reducer: 'mean' },
        { key: 'lw_up', col: 9, label: 'LW up', unit: W, color: '--c-lw-up', reducer: 'mean' },
      ],
      derived: [
        {
          key: 'net',
          label: 'Net',
          unit: W,
          color: '--c-ink',
          from: (v) =>
            v.sw_down == null || v.sw_up == null || v.lw_down == null || v.lw_up == null
              ? null
              : v.sw_down - v.sw_up + (v.lw_down - v.lw_up),
        },
      ],
    },
    note: 'The make and model of the net radiometer are not recorded on the legacy site.',
  },
  {
    id: 'ceilometer',
    name: 'Ceilometer',
    model: 'Vaisala CL31',
    category: 'clouds',
    measures:
      'A 910 nm pulsed lidar pointed at zenith. It reports up to three cloud-base heights and a 10 m-resolution attenuated backscatter profile up to 7.5 km.',
    legacyPage: 'ceil',
    archive: [
      { code: 'ceil', label: 'Ceilometer' },
      { code: 'dens', label: 'Ceilometer lidar (backscatter)' },
    ],
    series: {
      dir: 'ceilometer',
      prefix: 'ceil',
      intervalSec: 60,
      fields: [
        { key: 'cbh1', col: 1, label: 'Cloud base 1', unit: 'm', color: '--c-cloud', reducer: 'mean', zeroIsNull: true },
        { key: 'cbh2', col: 2, label: 'Cloud base 2', unit: 'm', color: '--c-cloud-2', reducer: 'mean', zeroIsNull: true },
        { key: 'cbh3', col: 3, label: 'Cloud base 3', unit: 'm', color: '--c-cloud-3', reducer: 'mean', zeroIsNull: true },
      ],
    },
  },
  {
    id: 'sunphotometer',
    name: 'Sun photometer',
    model: 'Kipp & Zonen PGS-100',
    category: 'clouds',
    measures:
      'A sun-tracking spectrometer that measures direct-beam spectral irradiance. Aerosol and trace-gas optical depth in the vertical column are retrieved from it.',
    legacyPage: 'sun',
    archive: [
      { code: 'sun', label: 'Sun photometer' },
      { code: 'sun_tau', label: 'Optical depth' },
    ],
  },
  {
    id: 'precipitation-gauge',
    name: 'All-weather precipitation gauge',
    model: 'ETI NOAH IV',
    category: 'precipitation',
    measures:
      'An electronic weighing gauge that records liquid-equivalent accumulation for rain and snow. Accumulation resets at local midnight.',
    legacyPage: 'rain',
    archive: [{ code: 'rain', label: 'Precipitation gauge' }],
    series: {
      dir: 'rain',
      prefix: 'rain',
      intervalSec: 60,
      fields: [
        // Logged in inches; converted to mm.
        { key: 'accum', col: 1, label: 'Accumulation since local midnight', unit: 'mm', color: '--c-precip', reducer: 'last', scale: 25.4 },
      ],
    },
  },
  {
    id: 'disdrometer',
    name: 'Laser optical disdrometer',
    model: 'OTT Parsivel²',
    category: 'precipitation',
    measures:
      'A 650 nm laser sheet that sizes each falling hydrometeor and times its fall speed. From the joint size–velocity distribution it classifies precipitation type and derives rain rate, equivalent radar reflectivity and visibility.',
    legacyPage: 'disd',
    archive: [{ code: 'disd', label: 'Disdrometer' }],
  },
  {
    id: 'micro-rain-radar',
    name: 'Micro Rain Radar',
    model: 'Metek MRR-2',
    category: 'precipitation',
    measures:
      'A vertically pointing 24 GHz FM-CW Doppler radar. It profiles reflectivity, fall velocity, rain rate and liquid water content at ~30 m vertical and ~10 s temporal resolution.',
    legacyPage: 'mrr',
    archive: [{ code: 'mrr_avg', label: 'Micro Rain Radar' }],
    specUrl: 'https://metek.de/product/mrr-2/',
  },
  {
    id: 'ozone',
    name: 'Ozone monitor',
    model: 'Thermo Environmental Model 49',
    category: 'chemistry',
    measures:
      'Surface ozone mixing ratio by UV photometry: absorption of the 254 nm mercury line in a sample cell, referenced against ozone-scrubbed air.',
    legacyPage: 'ozone',
    archive: [{ code: 'ozone', label: 'Ozone' }],
    series: {
      dir: 'ozone',
      prefix: 'ozone',
      intervalSec: 10,
      // The file header labels this column "(cm)", but it is 50 ppb/V × voltage, i.e. ppb.
      fields: [{ key: 'o3', col: 1, label: 'Ozone', unit: 'ppb', color: '--c-o3', reducer: 'mean' }],
    },
  },
];

export const byId = (id: string): Instrument => {
  const inst = INSTRUMENTS.find((i) => i.id === id);
  if (!inst) throw new Error(`Unknown instrument ${id}`);
  return inst;
};

/** Every code accepted by the legacy archive, in its original order. */
export const ARCHIVE_PRODUCTS: { code: string; label: string }[] = [
  { code: 'pyra', label: 'Pyranometer' },
  { code: 'pyrg', label: 'Pyrgeometer' },
  { code: 'spn', label: 'Total/diffuse pyranometer' },
  { code: 'allsky', label: 'All-sky image' },
  { code: 'ceil', label: 'Ceilometer' },
  { code: 'dens', label: 'Ceilometer lidar (backscatter)' },
  { code: 'sun', label: 'Sun photometer' },
  { code: 'sun_tau', label: 'Optical depth' },
  { code: 'rain', label: 'Precipitation gauge' },
  { code: 'disd', label: 'Disdrometer' },
  { code: 'mrr_avg', label: 'Micro Rain Radar' },
  { code: 'ozone', label: 'Ozone' },
  { code: 'netrad', label: 'Net radiometer' },
  { code: 'sound', label: 'Sounding' },
];

export const STATION = {
  name: 'Skywatch Observatory',
  lat: 40.01,
  lon: -105.24,
  elevationM: 1603,
  place: 'East Campus, University of Colorado Boulder',
  email: 'skywatch@colorado.edu',
};
