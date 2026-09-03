// Visual check: node test/hot-comment-preview.cjs, then open http://127.0.0.1:18766.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const renderer = path.join(__dirname, '../renderer');
const index = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const start = index.indexOf('<div class="hot-comment">');
const capsule = index.slice(start, index.indexOf('</div>', index.indexOf('</div>', start) + 6) + 6);
http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const files = {
    '/styles.css': ['styles.css', 'text/css'],
    '/hot-comment-motion.js': ['hot-comment-motion.js', 'text/javascript'],
    '/avatar.png': ['assets/icon.png', 'image/png'],
  };
  const file = files[req.url];
  if (file) {
    res.setHeader('Content-Type', file[1]);
    return res.end(fs.readFileSync(path.join(renderer, file[0])));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><link rel="stylesheet" href="/styles.css">
    <style>body{background:radial-gradient(ellipse at 20% 80%,#666039,#181b18);padding:36px}
    .hot-comment{left:64px;bottom:100px;width:300px}button{margin:8px;padding:12px}</style>
    </head><body data-view="playing"><button id="next">切换评论</button>
    <button id="same">相同评论</button><button id="clear">重置</button>${capsule}
    <script src="/hot-comment-motion.js"></script><script>
    const pill = document.querySelector('.hot-comment');
    const motion = BiuHotCommentMotion.create(pill);
    const samples = [
      {text:'夏天快过去啦！抓紧把这个歌再听一遍。',avatar:'/avatar.png'},
      {text:'旋律响起，就像又回到了那个夏天。',avatar:null},
      {text:'好喜欢这首歌，想起傍晚的风、路边的树，还有和朋友一起走回家的那段路。',avatar:'/avatar.png'}
    ];
    let current = 0;
    function show(animate = true) {
      motion.update(samples[current], data => {
        document.getElementById('hotCommentText').textContent = data.text;
        const avatar = document.getElementById('hotCommentAvatar');
        avatar.replaceChildren();
        const node = document.createElement(data.avatar ? 'img' : 'span');
        if (data.avatar) node.src = data.avatar;
        else node.className = 'cdot';
        avatar.appendChild(node);
      }, {animate});
    }
    document.getElementById('next').onclick = () => {current = (current + 1) % samples.length;show()};
    document.getElementById('same').onclick = () => show();
    document.getElementById('clear').onclick = () => {motion.clear();current = 0;show(false)};
    show(false);
    </script></body></html>`);
}).listen(18766, '127.0.0.1', () => console.log('Hot-comment preview: http://127.0.0.1:18766'));
