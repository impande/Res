# Resume4U — "Tailor to this job" (Chrome / Edge extension)

A tiny Manifest V3 extension. On a job posting (LinkedIn, Naukri, Internshala,
Indeed) it shows a floating **🎯 Tailor my résumé** button. One tap scrapes the
job description and opens **resume4u.help/?jd=…**, which auto-fills the site's
existing *"Tailor to a job description"* flow — so the user never copy-pastes a
posting again.

It pairs with the web-side hook (`_r4uIncomingJdJS` in `deploy-site/index.html`),
which reads `?jd=` and prefills the tailor textarea.

## How it works
```
Job page → [🎯 Tailor my résumé] → opens resume4u.help/?jd=<posting>
         → site auto-fills "Tailor to a job description" → ATS match + fixes
```

## Load it locally (for testing)
1. Go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `browser-extension/` folder.
4. Open a job posting on LinkedIn/Naukri/Internshala/Indeed — the button appears
   bottom-right. Click it.

> Chrome shows a default icon for an unpacked extension. Before publishing, add
> `icon16.png`, `icon48.png`, `icon128.png` to this folder and fill in the
> `"icons"` map in `manifest.json`.

## Publish to the Chrome Web Store (when ready)
1. Add the three icon sizes above.
2. Zip the contents of this folder (not the folder itself).
3. Create a listing at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time US $5 fee), upload the zip, add screenshots + description, submit for review.

## Adding more job sites
Add the site's URL pattern to `content_scripts.matches` in `manifest.json`, and
add the posting's CSS selector to `SELECTORS` at the top of `content.js`. There's
already a largest-text-block fallback for sites you haven't mapped yet.

## Privacy
The extension reads the job description only when you click the button, and only
to pass it to resume4u.help. It stores nothing and talks to no other server.
