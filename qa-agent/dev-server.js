#!/usr/bin/env node
'use strict';
/* Serves ../deploy-site locally with the same rewrites netlify.toml applies
 * (/r/* and /p/* → their index.html), for self-testing the agent:
 *   node dev-server.js            # http://localhost:8899
 *   npm run audit:local           # in another terminal
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'deploy-site');
const PORT = +(process.env.PORT || 8899);
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
}).listen(PORT, () => console.log('deploy-site served at http://localhost:' + PORT));
