const fs = require('fs');

let html = fs.readFileSync('deploy-site/index.html', 'utf8');

try {
  const JavaScriptObfuscator = require('javascript-obfuscator');
  let count = 0;
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (match, js) => {
    if (js.trim().length < 200) return match;
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
      return `<script>${result}</script>`;
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
