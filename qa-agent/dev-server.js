#!/usr/bin/env node
'use strict';
/* Serves the site locally with the same rewrites netlify.toml applies
 * (/r/* and /p/* → their index.html), for self-testing the agent.
 *
 *   node dev-server.js            # serve ../deploy-site as-is (raw source)
 *   node dev-server.js --build    # run build.js on a temp COPY and serve that —
 *                                 # the real production artifact (build id stamped,
 *                                 # obfuscated app.js). The working tree is never touched.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..');
const PORT = +(process.env.PORT || 8899);
let ROOT = path.join(REPO, 'deploy-site');

if (process.argv.includes('--build')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r4u-build-'));
  fs.cpSync(path.join(REPO, 'deploy-site'), path.join(tmp, 'deploy-site'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'build.js'), path.join(tmp, 'build.js'));
  const nm = path.join(REPO, 'node_modules');
  if (!fs.existsSync(path.join(nm, 'javascript-obfuscator'))) {
    console.error('Run `npm install` in the repo root first (build.js needs javascript-obfuscator).');
    process.exit(2);
  }
  fs.symlinkSync(nm, path.join(tmp, 'node_modules'), 'dir');
  cp.execSync('node build.js', { cwd: tmp, stdio: 'inherit', env: { ...process.env, COMMIT_REF: process.env.COMMIT_REF || cp.execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim() } });
  ROOT = path.join(tmp, 'deploy-site');
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(0); };
  process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
  console.log('built production artifact in ' + ROOT);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (/^\/r\/./.test(p)) p = '/r/index.html';
  else if (/^\/p\/./.test(p)) p = '/p/index.html';
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('site served at http://localhost:' + PORT));
