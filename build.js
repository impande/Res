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
        // own hex-named string-array + decoder helpers (e.g. _0x39d2). Separate
        // classic <script> tags share one global scope, so if two blocks happen to
        // generate the SAME helper name the second declaration clobbers the first's
        // string array — its lookups then return undefined → a runtime "reading
        // 'charAt'" crash that kills every block after it. Because the generator is
        // unseeded this collided only on some builds, randomly breaking features on
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

fs.writeFileSync('deploy-site/index.html', html);
console.log('✅ Build complete');
