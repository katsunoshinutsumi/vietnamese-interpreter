// Serves the app on http://localhost:8000 (the mic needs a localhost or https page)
// and /tts, which relays Google's online voice so no voice pack has to be installed.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const tls = require('tls');

// trust the Windows certificate store too (antivirus or company proxies re-sign HTTPS)
try { tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]); } catch {}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function tts(req, res, url) {
  const q = url.searchParams.get('q') || '';
  const tl = /^(vi|ja)$/.test(url.searchParams.get('tl')) ? url.searchParams.get('tl') : 'vi';
  const src = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(q.slice(0, 200))}`;
  https.get(src, { headers: { 'User-Agent': 'Mozilla/5.0' }, family: 4, timeout: 10000 }, up => {
    res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] || 'audio/mpeg' });
    up.pipe(res);
  }).on('timeout', function () { this.destroy(new Error('timeout')); })
    .on('error', e => { console.error('音声の取得に失敗:', e.code || e.message); res.writeHead(502); res.end(); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/tts') return tts(req, res, url);
  // static files from this folder; anything unknown gets the app page
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(__dirname, rel);
  const safe = file.startsWith(__dirname + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile();
  const target = safe ? file : path.join(__dirname, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}).listen(8000, () => console.log('通訳ページ: http://localhost:8000'));
