// Read-only visual fixture: uses the real header markup and stylesheet at startup/window widths.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const heading = index.slice(index.indexOf('<div class="np-heading"'), index.indexOf('<div class="np-actions"')) + '</div></div>';
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/assets/icon.png') {
    res.setHeader('Content-Type', 'image/png');
    return res.end(fs.readFileSync(path.join(root, 'renderer/assets/icon.png')));
  }
  if (req.url === '/boot') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<link rel="stylesheet" href="/styles.css">' +
      index.slice(index.indexOf('<div class="boot-mask"'), index.indexOf('<!-- ============ 背景层')));
  }
  if (req.url === '/styles.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(fs.readFileSync(path.join(root, 'renderer/styles.css')));
  }
  const sample = heading.replace('未在播放', 'TANK的重生，为这首《阿门》赋予了新的含义')
    .replace('来源 · —', '来源 · BV1UUjBnEBjabcdefghijklmn').replace('<div class="np-album" id="npAlbum"></div>', '<div class="np-album" id="npAlbum">風吹散的從前</div>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<style>body{background:#151515;color:white;font:16px system-ui}iframe{border:1px solid #777}</style>' +
    [960, 1120, 1440].map(width => `<h2>${width} × 720</h2><iframe width="${width}" height="420" srcdoc="${esc(
      `<link rel="stylesheet" href="/styles.css"><body class="video-on" data-view="playing"><div style="margin:25px;width:31vw">${sample}</div></body>`
    )}"></iframe>`).join(''));
}).listen(18765, '127.0.0.1', () => console.log('Layout fixture: http://127.0.0.1:18765'));
