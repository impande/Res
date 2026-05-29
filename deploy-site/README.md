# deploy-site (Netlify publish directory)

Netlify is configured with **this folder as the base/publish directory**
(see `netlify.toml`).

## ⚠️ Single source of truth: the repo-root `index.html`

**Edit `../index.html` (repo root), not the copy in this folder.**

At deploy time, `netlify.toml` runs:

```
cp ../index.html index.html
```

so the root `index.html` is copied here and published. The `index.html`
committed in this folder is just a fallback/snapshot — it is overwritten on
every deploy. If you edit it directly, your change will be lost the next time
the site builds.

## Function

`netlify/functions/generate.js` proxies requests to the Anthropic API.
The API key lives **only** in the Netlify environment variable
`ANTHROPIC_API_KEY` — never in any committed file.
