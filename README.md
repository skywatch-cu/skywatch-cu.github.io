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
                                                                  │
                                                          astro build → GitHub Pages
```

- The legacy server sends no CORS headers, so the browser can't fetch its data. Instead, each GitHub Actions build fetches and parses it, every 15 minutes.
- Charts are drawn in the browser from the per-instrument JSON. Images with stable URLs (the all-sky and Front Range cameras) are hotlinked and refresh every 2 minutes on the client.
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

To add a logged instrument, add a `series` block to its entry in `src/data/instruments.ts`. Give it the `/data/` directory, the file prefix and the column indices. Its chart and JSON are then generated automatically.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`, every 15 minutes, and on manual dispatch. Each run tests, fetches data, builds and deploys to Pages.

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
