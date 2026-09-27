# resume4u live audit agent

A real Chromium browser that behaves like your users on the **live** site
(`https://resume4u.help`). It builds résumés, uses every AI feature, tries all
the templates, shares and downloads, then emails you a report.

It runs **every day at 08:00 IST**, and **whenever you ask**:
GitHub → **Actions** → **live-audit** → **Run workflow** (this also works from
the GitHub mobile app).

## What it tests

| Suite (`SUITES=`) | Journey |
|---|---|
| `health` | Homepage speed & title, live build stamp, every sitemap page (200 + title + meta description), static assets, `/r/` & `/p/` viewers, Firebase/Razorpay scripts reachable, `generate` function up |
| `build` | **Journey A, desktop from scratch.** Every wizard step typed like a person: title chips, photo upload + crop, 2 jobs (add/remove), rich-text notes, **AI bullets**, award, key achievement + **AI "Suggest 5"**, 2 schools, skills (button/Enter/remove) + **AI skill suggestions**, custom section, sidebar navigation keeps data, live preview, template filters, **AI generation** (checks every entered field is in the résumé), quick-tips popup, ATS score, inline edit survives a template switch, **all 90+ templates render**, S/M/L text size, DOC download, PDF paywall (never paid) |
| `share` | **Journey B.** Share/QR publishes, Download QR, the `/r/` link opens on a phone for a fresh visitor **without being cut off**, "Refine with AI" (ATS breakdown, **ATS match to a job**, **Tailor my résumé to this job**, Bullet coach, **Rewrite summary**), **AI cover letter** + DOC |
| `portfolio` | **Journey C.** Portfolio builder: sections, photo, case study, include/exclude, **every design re-renders**, HTML download, pick a URL → publish → `/p/` opens for a visitor |
| `import` | **Journey D.** Paste résumé text → **AI parse** → fields/jobs/schools/skills → generate; **upload a real PDF** → AI extraction; **GitHub import** |
| `mobile` | **Journey E, iPhone 13 with touch.** No sideways scrolling on any step, "Step N of 8" header, generate, résumé fits the screen, full-screen preview + template picker, tap-target sizes, DOC download |
| `edge` | **Journey F.** Empty form shows a "Required" message, Hindi/apostrophe/ampersand names, **XSS: typed HTML must never execute**, guest reload, **Google sign-in opens** (not completed), **Razorpay checkout opens** (never paid) |

### Web standards

| Suite | Standard |
|---|---|
| `a11y` | **WCAG 2.1 AA** via axe-core on the homepage and all 8 builder steps, keyboard-only use with a visible focus ring, 320px reflow, `lang`, pinch-zoom allowed, image alt text |
| `perf` | **Core Web Vitals** (LCP, CLS, TBT, TTFB) and page weight against Google's thresholds, on desktop and on a throttled mid-range phone over 4G; every landing page under 3s; gzip/brotli and cache headers |
| `seo` | For every sitemap page: title/description length, one H1, canonical, noindex, duplicate titles; **Open Graph + Twitter** previews incl. OG image size; valid **JSON-LD**; robots.txt |
| `security` | HTTP→HTTPS redirect; **HSTS, nosniff, clickjacking protection**, Referrer-Policy/CSP/Permissions-Policy; mixed content; cookie flags; **leaked API keys/secrets** in public JS; backend error hardening |
| `links` | Broken internal + external links, real 404s, **legal pages (Privacy, Terms, Refund, Contact)**, PWA manifest |
| `browsers` | Builder smoke test in **Safari (WebKit, iPhone)** and **Firefox** |

Every run also records JavaScript errors, console errors, failed network requests
and the latency of each backend call (`/.netlify/functions/*`, Firestore, GitHub API).

### Side effects on the live site (by design)
- **AI calls:** about 15 small Claude calls per run, like a single real user.
- **Public test pages:** one `/r/qa-audit…` résumé (expires in 30 days) and one
  `/p/qa-audit-…` portfolio per run, named `QA Audit<date>` so they're easy to spot.
  Turn off with the `publish` checkbox (manual runs) or `PUBLISH=0`.
- **Razorpay:** the checkout is opened, which creates one unpaid order. **Nothing
  is ever paid.**

## Report

- **Email** to `2ashishpandey@gmail.com` (change it with the `REPORT_TO` repository variable).
  The subject line gives the verdict, e.g. `🟢 resume4u audit 2026-09-28: 81/81 passed`.
- The email lists **what needs attention** first (failures, then warnings, by severity),
  then every scenario with timings, then JS errors and backend latency. `report.html`,
  `report.json` and failure screenshots are attached.
- The GitHub run keeps the full report + all screenshots as an artifact for 30 days.
  The run turns **red** when a *critical* journey is broken.

## One-time setup (email)

The agent sends mail through a Gmail account, using an **App Password** (not your
normal password):

1. Google Account → **Security** → turn on **2-Step Verification**.
2. Google Account → **Security** → **App passwords** → create one called "resume4u audit".
   Copy the 16-character password.
3. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - `SMTP_USER` = the Gmail address that sends (e.g. `2ashishpandey@gmail.com`)
   - `SMTP_PASS` = the app password from step 2
4. Optional **variables** on the same page: `REPORT_TO` (a different recipient), or
   `SMTP_HOST` / `SMTP_PORT` for a non-Gmail provider (defaults are `smtp.gmail.com` / `465`).

Without these secrets the audit still runs and the report is still saved on the run,
but the step fails with `EMAIL FAILED: SMTP_USER / SMTP_PASS not set`.

> GitHub only runs **scheduled** workflows from the default branch (`main`), and
> pauses them after 60 days without repository activity. "Run workflow" always works.

## Run it yourself

```bash
cd qa-agent
npm ci && npx playwright install chromium
node run.js                                   # full audit of the live site + email
SEND_EMAIL=0 node run.js                      # no email; report in reports/<time>/
SUITES=build,mobile SEND_EMAIL=0 node run.js  # just some journeys
HEADFUL=1 SUITES=build node run.js            # watch the browser do it
```

### Developing the agent offline
`MOCK_AI=1` fakes the AI, Firestore and GitHub answers so the agent itself can be
tested against a local copy of `deploy-site/`. It's for development only, and those
reports are stamped **MOCK**.

```bash
npm install --prefix ..        # build.js needs javascript-obfuscator
node dev-server.js --build &   # runs build.js on a temp COPY and serves the real
                               # production artifact (build id, obfuscated app.js);
                               # your working tree is never modified
npm run audit:local
```

### Environment-limited checks
At start-up the agent probes, from inside the browser, whether this runner can reach
Firebase (gstatic), Google sign-in, Razorpay, cdnjs (pdf.js), Google Fonts, Firestore
and the GitHub API. A step that needs an unreachable host is **not** failed:
- on GitHub Actions (open internet) it's a **WARN**, meaning a possible third-party outage;
- anywhere else it's a **SKIP** marked **ENV** in the report.

Network errors from those hosts are left out of the JS/console/network error lists.
Against a `localhost` target, Netlify-only checks (headers, compression, functions,
HTTPS redirect) are ENV-skipped too. A grey banner at the top of the report lists
everything that was environment-limited, so an amber status always means a real
site issue.

## Files

- `run.js` runs the suites, writes the report and sends the email.
- `suites/*.js` hold the journeys, each step tagged `critical` / `major` / `minor`.
- `lib/harness.js` is the step runner (continue-on-failure, prerequisite skips, screenshots, error capture).
- `lib/app.js` and `lib/flows.js` hold helpers that drive the UI like a person (real clicks and typing, wait for layout to settle).
- `lib/report.js` builds the email-safe HTML report, and `lib/mailer.js` sends it over SMTP.
- `lib/fixtures.js` has the test personas, a résumé to paste, a generated PDF and a photo.
