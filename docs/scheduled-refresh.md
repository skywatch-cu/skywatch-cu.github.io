# Refreshing the site every 10 minutes

GitHub accepts `cron: '*/15 * * * *'` but runs scheduled workflows late on busy days. For this repository, runs arrived only every 3–4 hours. An external timer therefore calls GitHub's `workflow_dispatch` API every 10 minutes, and the cron stays as a backstop.

The timer needs a GitHub token that can do exactly one thing: start workflows in `skywatch-cu/skywatch-cu.github.io`.

## 1. Create a fine-grained token

1. Sign in to GitHub as an owner of the `skywatch-cu` organization.
2. Open <https://github.com/settings/personal-access-tokens/new>. This is your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Fill in:
   - **Token name:** `skywatch refresh timer`
   - **Description:** `cron-job.org calls workflow_dispatch on deploy.yml every 10 min`
   - **Resource owner:** `skywatch-cu`. This is the organization, not your personal account. If it isn't listed, see step 4.
   - **Expiration:** 1 year. Add a calendar reminder a week before the expiry date (see section 4).
   - **Repository access:** *Only select repositories* → `skywatch-cu/skywatch-cu.github.io`
   - **Permissions → Repository permissions → Actions:** *Read and write*. GitHub adds *Metadata: Read-only* automatically. Leave everything else at *No access*.
4. Click **Generate token** and copy it now; GitHub shows it only once. It starts with `github_pat_`.
   - If `skywatch-cu` was missing from the resource owners, or the token shows **Pending**: open <https://github.com/organizations/skywatch-cu/settings/personal-access-tokens>.
     - If fine-grained tokens are blocked, allow them.
     - If your token is waiting for approval, approve it under **Pending requests**.

Keep the token only in the timer service and in a password manager. Don't put it in the repository, an issue or a chat.

**What someone could do with a leaked token:** start, cancel or re-run this repository's workflows, and read or delete its run logs. They can't change code, settings or the site's content. To revoke it, return to the token list and click **Delete**.

## 2. Test the token from a terminal

```sh
read -s TOKEN   # paste the token, press Enter (it is not echoed or saved in history)
curl -i -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/skywatch-cu/skywatch-cu.github.io/actions/workflows/deploy.yml/dispatches \
  -d '{"ref":"main"}'
unset TOKEN
```

A `HTTP/2 204` response means it worked. A new **workflow_dispatch** run appears at <https://github.com/skywatch-cu/skywatch-cu.github.io/actions>.

- `401`: the token is wrong or has expired.
- `403` or `404`: the token doesn't cover this repository, lacks *Actions: Read and write*, or is still pending approval.

## 3. Set up the timer at cron-job.org

[cron-job.org](https://cron-job.org) is a free, donation-funded service run from Germany. It supports custom headers and request bodies, and it emails you on failures.

1. Create an account and confirm your email address.
2. Go to **Dashboard** → **Create cronjob**.
3. On the **Common** tab:
   - **Title:** `Skywatch site refresh`
   - **URL:** `https://api.github.com/repos/skywatch-cu/skywatch-cu.github.io/actions/workflows/deploy.yml/dispatches`
   - **Execution schedule:** *Every 10 minutes*
   - **Notify me when:** the execution fails, and when the job is disabled because of too many failures
4. On the **Advanced** tab:
   - **Request method:** `POST`
   - **Headers.** Add each one:

     | Key | Value |
     |---|---|
     | `Authorization` | `Bearer github_pat_…` (your token) |
     | `Accept` | `application/vnd.github+json` |
     | `X-GitHub-Api-Version` | `2022-11-28` |
     | `Content-Type` | `application/json` |
     | `User-Agent` | `skywatch-cu-refresh` |

   - **Request body:** `{"ref":"main"}`
   - **Treat redirects with HTTP 3xx status code as success:** off
5. Save. Use **Test run** if it's offered, then wait for the next execution.
6. Check **History** for status `204 No Content`, and check that runs appear in the repository's **Actions** tab about every 10 minutes.

## 4. Upkeep

- **Before the token expires:** create a new token as in section 1, paste it into the `Authorization` header in cron-job.org, then delete the old token.
- **If the site's "Readings as of" time stops advancing:**
  1. Check cron-job.org's History first.
  2. Then check the Actions tab. If a run failed there, the fault is in the build, not in the timer.
- **Cost:** each run takes about 1–2 minutes. GitHub Actions minutes are free for public repositories. The `pages` concurrency group queues overlapping runs rather than running them in parallel.

## Alternatives

- **Another scheduler:** any service that can send an authenticated POST works the same way, for example a CU research server's crontab or a Cloudflare Worker cron trigger. Use the URL, headers and body above.
- **Drop the timer entirely:** if the observatory server adopts [`data-contract.md`](data-contract.md) (Phase 2), the browser can read live data directly. Rebuilds are then needed only for content changes.
