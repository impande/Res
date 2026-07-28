# SEO Submissions dashboard (`/seo-admin/`)

A semi-automated, human-in-the-loop tool for off-page SEO: it curates and
auto-discovers submission targets (directories, Quora questions, bookmarking
sites), AI-drafts the copy, tracks status, and gives a one-click **Submit ↗**
that copies the content + opens the target page. A human still clicks the final
Submit on each platform — by design, so resume4u.help stays clear of link-spam
penalties and the accounts avoid automation bans.

## Pieces

| File | Role |
|------|------|
| `seo-admin/index.html` | The dashboard UI (token-gated, `noindex`). |
| `netlify/functions/seo-submissions.js` | State store (Netlify Blobs) + curated seed list. |
| `netlify/functions/seo-draft.js` | AI copywriting via the Anthropic API. |
| `netlify/functions/seo-discover.js` | Auto-discovery (Semrush backlinks + Quora search). |

## Environment variables (Netlify → Site settings → Environment variables)

| Var | Required? | Used for |
|-----|-----------|----------|
| `SEO_ADMIN_TOKEN` | **Yes** | Login/gate for the dashboard + all its functions. Set any long random string; this is your password. Without it every function returns 500. |
| `ANTHROPIC_API_KEY` | **Yes** | AI copy drafting. Already set for the main app's `generate` function. |
| `SEMRUSH_API_KEY` | Optional | Directory auto-discovery (Semrush Analytics API). Without it that button shows a clear message; the curated list still works. |
| `SERPAPI_KEY` | Optional | Better Quora question discovery. Without it a keyless DuckDuckGo fallback is used (works but can be rate-limited). |

Working state (statuses, custom targets, cached drafts) is stored **in the
browser (localStorage)**, so no server-side data store is needed. State is
per-browser; if you later want it shared across devices, swap the client
persistence for a server store (Netlify Blobs or Firestore) in `seo-submissions.js`.

## Testing (UAT)

1. Get this branch onto a Netlify build (merge into `uat`, or a Deploy Preview).
2. Set `SEO_ADMIN_TOKEN` on that Netlify context.
3. Visit `/seo-admin/` on the UAT/preview URL and enter the token.
4. First load auto-seeds the curated target list.

### Smoke test checklist
- [ ] Dashboard loads and the token unlocks it (wrong token is rejected).
- [ ] Tabs (Directories / Quora / Bookmarking / All) show counts.
- [ ] **Generate copy** returns draft text on a directory row and a Quora row.
- [ ] **Submit ↗** copies content, opens the site, and marks the row Submitted.
- [ ] Status dropdown persists across a reload (Blobs write works).
- [ ] Add a custom target; it appears and persists.
- [ ] **Discover targets** on Directories/Quora (needs the optional keys) merges
      new rows tagged `auto`, without duplicating existing ones.
