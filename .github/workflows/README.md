# Free journey checker

This generic repository runs browser checks for a private Deltos Journey Monitor dashboard. No monitor URLs, destination rules, logs, screenshots or credentials belong in this repository. The dashboard supplies selected monitor configuration privately at runtime.

## One-time setup

1. Create an empty **public** GitHub repository dedicated to this checker. Standard GitHub-hosted runners are free in public repositories. Private repositories have a limited monthly allowance that can be exhausted by a ten-minute schedule.
2. Extract the dashboard's checker ZIP and upload its contents to the repository root, **including `.github/workflows/check.yml`**. Use Git locally if the browser file chooser hides `.github`. Commit to the default branch.
3. In repository Settings → Secrets and variables → Actions, add repository secrets:
   - `MONITOR_SITE_URL`: your dashboard's full HTTPS URL (no extra path).
   - `MONITOR_JOB_TOKEN`: generate once in the dashboard's Free setup dialog. Treat it as a password. It grants read access to scheduled monitor configuration and write access to check results, not dashboard administration or historical logs. Rotation revokes the previous token.
4. Save the repository URL in the dashboard's Free setup dialog.
5. Add or edit up to three monitors. Set the source URL, required destination substring, and turn on **Include in automatic checks**. Copied monitors are unselected by default.
6. In GitHub Actions → Journey checks → Run workflow, run once. Open the dashboard to verify a recorded check from a US IP.

No Render account, service URL, paid instance or always-on server is required. Do not upload the dashboard's source repository; it contains your private monitor configuration. This ZIP contains only generic checker code.

## Scheduling and limits

The schedule requests a run at minutes 7, 17, 27, 37, 47 and 57 UTC. GitHub can delay or drop scheduled jobs; exact ten-minute coverage is not guaranteed. Check freshness is shown separately and observations older than 20 minutes are overdue. A GitHub public-repository schedule may be disabled after 60 days without repository activity; re-enable it in Actions when needed. No artificial keepalive commits are made.

Free hosted runners do not guarantee a US region or fixed IP. Before each journey, the same browser and proxy checks its apparent country through Cloudflare trace. If it cannot verify US, that journey is skipped and the dashboard flags the cycle. This is a data-center IP, not a residential proxy. Blocklists, bot challenges and suspected security-warning text are evidence for review, not exhaustive reputation certification.

Checks use a real Chromium browser, validate the final URL using a literal case-sensitive substring, record HTTP/JavaScript/network errors and timings, and click eligible navigation controls within configured depth/click/time limits. Buttons with no observed effect and possible dead ends are reported. Forms, payment/sign-in controls, downloads, WebSockets, and embedded-frame interactions are left for manual review. A passing check only covers observed paths. Each journey has a 180-second total budget; up to three run sequentially in one 12-minute job.

The proxy rejects private/reserved network addresses and pins DNS resolution. Chromium sandboxing is enabled. State-changing requests are blocked. GET navigation may still trigger analytics. Use only sites you are authorized to test.

## History and privacy

Full event logs are stored privately for up to 7 days; summaries for 30 days; at most two small problem screenshots per check for up to 3 days. A 1 GB file-storage cap removes oldest files sooner. Cleanup runs as jobs arrive; expired data is hidden immediately when requested even if the next cleanup has not run. Event logs above 1.7 MB are truncated and explicitly marked for review. Nothing is uploaded as a public GitHub artifact. Console output avoids destination URLs and raw exceptions.

A run needs both repository secrets. Do not enable debug tracing or echo secrets. Do not trigger this workflow from untrusted pull requests. Job permissions only allow reading the repository. Keep generic checker code reviewed before allowing it access to the secrets.

## Verification sources

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
