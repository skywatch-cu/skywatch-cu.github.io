# Skywatch Observatory website

This is the rebuilt, mobile-friendly site for the CU Boulder ATOC **Skywatch Observatory**. It replaces the PHP pages at <https://skywatch.colorado.edu>.

- **Live:** <https://skywatch-cu.github.io>. `skywatch.colorado.edu` will move here once CU IT approves; see [Custom domain](#custom-domain).
- **Stack:** [Astro](https://astro.build), a static TypeScript site, with [uPlot](https://github.com/leeoniya/uPlot) for interactive charts. It's hosted on GitHub Pages.

## How it works

```
skywatch.colorado.edu (legacy Apache server, unchanged)
   ├─ /                         status table      ─┐
   ├─ /php/<instrument>.php     today's PNG plots  ├─ scripts/fetch-data.ts (every 15 min in CI)
   ├─ /php/event.php            soundings list     │     ├─ .cache/snapshot.json
   └─ /data/<dir>/*_YY_MM_DD.dat raw logger files ─┘     └─ public/data/series/<id>.json (24 h, 1-min)
api.weather.gov (NWS) ── forecast, hourly, alerts, discussion ──→ public/data/forecast.json
api.open-meteo.com ───── HRRR 15-min irradiance, precipitation ─→ public/data/hrrr.json
                                                                  │
                                                          astro build → GitHub Pages
                                                                  │
                                         browser re-fetches api.weather.gov every 15 min
```

- The legacy server sends no CORS headers, so the browser can't fetch its data. Instead, each GitHub Actions build fetches and parses it, every 15 minutes.
- Charts are drawn in the browser from the per-instrument JSON. Images with stable URLs (the all-sky and Front Range cameras) are hotlinked and refresh every 2 minutes on the client.
- Forecasts come from the [NWS API](https://www.weather.gov/documentation/services-web-api), which does allow CORS. The build saves a copy for first paint, and each page then fetches the NWS directly and refreshes every 15 minutes. Forecasts therefore stay current even when a site rebuild is late.
- The forecast-vs-observed comparison on the forecast page uses NOAA's HRRR model through [Open-Meteo](https://open-meteo.com/en/docs) (CC BY 4.0, credit required), which also allows CORS. Past hours are short-range forecasts stitched from successive runs. The page pairs them with the pyranometer, SPN1 and rain gauge series, and computes bias, RMSE and insolation in the browser (`src/lib/verify.ts`).
- If the legacy server is down, the previous snapshot is restored from the Actions cache. The site then shows stale data with a warning rather than failing.
- [`docs/data-contract.md`](docs/data-contract.md) is the proposal for a direct data feed (Phase 2), to give to the server administrator.

## Working on it

Requires Node ≥ 22.23, which runs `scripts/*.ts` with no build step.

```sh
npm install
npm run fetch-data   # pull current data from the observatory server
npm run dev          # http://localhost:4321
npm test             # parser tests against saved fixtures in tests/fixtures/
npm run build        # static site in dist/
```

### Where things live

| To change… | Edit |
|---|---|
| Instrument names, models, descriptions, plotted columns, colours | `src/data/instruments.ts` |
| How `.dat` files are parsed or binned | `src/lib/dat.ts` (and add a test) |
| How legacy HTML is scraped | `src/lib/legacy.ts` |
| The page shell, nav, footer | `src/layouts/Base.astro` |
| Colours, type scale, dark mode | `src/styles/global.css` |
| About, teaching, partnerships, publications | `src/pages/about.astro` |
| NWS requests, parsing, contact User-Agent | `src/lib/providers/nws.ts` (and `tests/nws.test.ts`) |
| Forecast markup (shared by build and browser) | `src/lib/render/forecast.ts` |
| Forecast page | `src/pages/forecast.astro`, `src/components/Forecast*.astro`, `HourlyForecast.astro`, `AlertBanner.astro` |
| HRRR requests (Open-Meteo) | `src/lib/providers/openmeteo.ts` |
| Forecast-vs-observed statistics | `src/lib/verify.ts`, `src/lib/render/verify.ts` (and `tests/verify.test.ts`) |
| Forecast-vs-observed charts | `src/components/ForecastVsObserved.astro` |

To add a logged instrument, add a `series` block to its entry in `src/data/instruments.ts`. Give it the `/data/` directory, the file prefix and the column indices. Its chart and JSON are then generated automatically.

To add another external data source (radar, soundings), add a module next to `src/lib/providers/nws.ts`. It should have pure normalizers into SI types, tests against saved responses, and fetch functions that work in both Node and the browser. Then add a renderer and a component that subscribes to live updates, as in `src/lib/forecast-client.ts`.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`, on a 15-minute schedule, and on `workflow_dispatch`. Each run tests, fetches data, builds and deploys to Pages. GitHub runs the schedule only every few hours, so an external timer triggers the workflow every 10 minutes; see [`docs/scheduled-refresh.md`](docs/scheduled-refresh.md).

> **Note:** GitHub disables scheduled workflows in a public repository after 60 days with no commits. Re-enable the workflow from the Actions tab, or push any commit.

### Custom domain

Once `skywatch.colorado.edu` (or another name) points at GitHub Pages:

1. Add `public/CNAME` containing the hostname.
2. Set `site` in `astro.config.mjs`.
3. Set the domain under the repo's Settings → Pages, and enforce HTTPS.

The site then serves on the same host as the legacy `/data/` files. Retire the PHP pages only after the data feed in `docs/data-contract.md` is running somewhere else.

## Known gaps

- The make and model of the net radiometer, and the all-sky camera's orientation, aren't recorded on the legacy site.
- The disdrometer, the Micro Rain Radar, the sun photometer and the ceilometer backscatter still show the server's PNGs. Their raw formats are binned spectra or profiles, not simple time series.
- The archive opens days on the legacy archive server (`php/data.php`).
