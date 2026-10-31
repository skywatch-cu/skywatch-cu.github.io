# Skywatch data feed: proposed contract

**Audience:** the administrator of `skywatch.colorado.edu` (Apache, RHEL).
**Purpose:** let the new site at `skywatch-cu.github.io` read observatory data directly in the browser, with no scraping and no 15-minute rebuild cycle.

## How the new site gets data today (Phase 1)

A GitHub Actions job runs every 15 minutes. It downloads these files from the legacy server:

- the homepage status table
- each `php/<instrument>.php` page, for today's PNG plot names
- the current and previous local-day `.dat` files: `/data/<dir>/<prefix>_YY_MM_DD.dat`

The job parses them (`src/lib/legacy.ts` and `src/lib/dat.ts`) and redeploys the static site. This works because those URLs are public. It has three costs:

- **Latency.** Readings are 15–20 minutes old.
- **Fragility.** The scraper breaks if the HTML changes.
- **Size.** About 9 MB is transferred per run, mostly two ceilometer files.

## What we are asking for (Phase 2)

Either option works. Both need only a cron job and static files on the existing server.

### Option A: add CORS to the existing `/data/` tree (smallest change)

```apache
<Directory "/var/www/html/data">
    Header set Access-Control-Allow-Origin "*"
</Directory>
```

The browser can then fetch `.dat` files directly. Publishing the two files in Option B would still help, because they avoid sending large raw files to phones.

### Option B: publish two small derived files every minute

Write them atomically: write to a temporary file, then `mv` it into place. Serve them with the CORS header above and `Cache-Control: max-age=60`.

**`/data/feed/latest.json`**

```json
{
  "observed_at": "2026-10-31T00:48:00Z",
  "station": { "lat": 40.01, "lon": -105.24, "elevation_m": 1603 },
  "values": {
    "sw_down":       { "value": 0.0,   "unit": "W m-2" },
    "sw_diffuse":    { "value": 0.0,   "unit": "W m-2" },
    "lw_down":       { "value": 289.0, "unit": "W m-2" },
    "net_radiation": { "value": -57.0, "unit": "W m-2" },
    "precip_today":  { "value": 0.0,   "unit": "mm" },
    "rain_rate":     { "value": 0.0,   "unit": "mm h-1" },
    "snow_depth":    { "value": 0,     "unit": "mm" },
    "ozone":         { "value": 24.0,  "unit": "ppb" },
    "cloud_base_1":  { "value": 7530,  "unit": "m AGL" }
  }
}
```

- All times are ISO-8601 UTC.
- A missing or failed sensor is `null`, never `0`.
- Units are SI except ppb, kept for convention.

**`/data/feed/series/<instrument>/<YYYY-MM-DD>.csv`**

Each file holds one UTC day at 1-minute means:

```
time_utc,sw_down
2026-10-30T06:00:00Z,1.2
```

A `manifest.json` lists the available days for each instrument, so the archive page can disable dates that have no data.

## Corrections to carry over from the legacy files

| File | Issue | Handling in the new site |
|---|---|---|
| `ozone_*.dat` | The header says `Ozone (cm)`. The values are ppb (50 ppb/V × voltage). | Labelled as ppb |
| `rain_*.dat` | Accumulation is in inches. | Converted to mm (× 25.4) |
| `ceil_*.dat` | `0` means "no cloud base detected". | Treated as missing |
| all `.dat` | The file covers a local day, but its row times are UTC and cross UTC midnight. | Rows after the wrap get the next UTC date |

## Switching the site over

`src/lib/legacy.ts` contains the HTML scrapers. When Phase 2 lands:

1. Add `src/lib/feed.ts`, which returns the same `Status` and `SeriesFile` shapes (`src/lib/types.ts`).
2. Have the "Now" panel poll `latest.json` every 60 s on the client.
3. Drop the 15-minute schedule in `.github/workflows/deploy.yml`. Rebuilds are then needed only for content changes.
