const fs = require('fs');

let html = fs.readFileSync('deploy-site/index.html', 'utf8');

// Stamp the build id (git commit + UTC build time) so the deployed page can show
// which build is live — invaluable for telling "latest" from "browser-cached".
// Netlify exposes the commit SHA via COMMIT_REF.
const buildId = ((process.env.COMMIT_REF || '').slice(0, 7) || 'local') +
                ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
html = html.replace(/__BUILD_ID__/g, buildId);
console.log('✅ Build id: ' + buildId);

try {
  const JavaScriptObfuscator = require('javascript-obfuscator');
  let count = 0;
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (match, js) => {
    if (js.trim().length < 200) return match;
    // Skip blocks that are already obfuscated — any block whose first 100 chars
    // contain a hex-style _0x identifier (all obfuscator output has this).
    if (/_0x[0-9a-f]{3,}/i.test(js.trim().slice(0, 100))) return match;
    try {
      const result = JavaScriptObfuscator.obfuscate(js, {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        // Each <script> block is obfuscated INDEPENDENTLY, so each one generates its
        // own hex-named string-array + decoder helpers (e.g. _0x39d2). All blocks are
        // then concatenated into app.js sharing one global scope — so if two blocks
        // happen to generate the SAME helper name, the second's declaration clobbers
        // the first's string array and its lookups return undefined → a runtime
        // "reading 'charAt'" crash that kills every block after it. Because the
        // generator is unseeded this collided only on some builds, randomly breaking
        // features (text size, reorder, undo, restore-to-step-7, the CTA count…) on
        // whichever deploy lost the dice roll. A per-block prefix makes every block's
        // generated identifiers unique, so cross-block collisions are impossible.
        identifiersPrefix: 'b' + count + '_',
        renameGlobals: false,
        selfDefending: false,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.5,
        transformObjectKeys: false,
        unicodeEscapeSequence: false
      }).getObfuscatedCode();
      count++;
      // Escape </script> so the HTML parser doesn't close the tag early.
      // In JS strings <\/script> == </script> at runtime; only the HTML parser cares.
      const safe = result.replace(/<\/script>/gi, '<\\/script>');
      return `<script>${safe}</script>`;
    } catch(e) {
      return match;
    }
  });
  console.log(`✅ Obfuscated ${count} script block(s)`);
} catch(e) {
  console.log('⚠️  javascript-obfuscator not available, deploying as-is:', e.message);
}

// ── Externalise all inline JS into one deferred, cacheable app.js ──────────────
// The page ships a large amount of inline JS the browser must parse before first
// paint. Moving it (after obfuscation) into a single deferred external file shrinks
// the HTML (faster FCP), moves JS download/compile off the critical path, and lets
// it be cached across visits. Only attribute-less <script> blocks are moved — the
// JSON-LD (<script type="application/ld+json">) and any typed scripts stay inline.
// Order is preserved and the blocks still share global scope, so behaviour is
// unchanged; only timing shifts to after HTML parse (safe: no document.write, no
// "use strict", DOMContentLoaded handlers still fire after defer).
try {
  const crypto = require('crypto');
  const scripts = [];
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, js) => { scripts.push(js); return ''; });
  if (scripts.length) {
    const appJs = scripts.join('\n;\n');
    fs.writeFileSync('deploy-site/app.js', appJs);
    const hash = crypto.createHash('sha1').update(appJs).digest('hex').slice(0, 10);
    const tag = `<script defer src="/app.js?v=${hash}"></script>\n`;
    const bi = html.lastIndexOf('</body>');
    html = (bi >= 0) ? html.slice(0, bi) + tag + html.slice(bi) : html + tag;
    console.log(`✅ Externalised ${scripts.length} script block(s) → app.js (${(appJs.length / 1024).toFixed(0)}KB, v=${hash})`);
  }
} catch (e) {
  console.log('⚠️  JS externalisation skipped (deploying inline):', e.message);
}

fs.writeFileSync('deploy-site/index.html', html);
console.log('✅ Build complete');
