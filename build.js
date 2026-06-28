const fs = require('fs');

let html = fs.readFileSync('deploy-site/index.html', 'utf8');

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
