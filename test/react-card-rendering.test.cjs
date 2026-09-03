const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let server;
let GCard;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: path.join(__dirname, '../vite.config.js'),
    server: { middlewareMode: true, watch: null, hmr: false },
  });
  ({ GCard } = await server.ssrLoadModule('/src/views/LibraryGrids.jsx'));
});
after(async () => { await server?.close(); });

const render = (cover) => renderToStaticMarkup(React.createElement(GCard, {
  title: '我喜欢', meta: '3 首歌曲', cover,
}));

test('React SVG covers retain their artwork instead of being treated as HTML descriptors', () => {
  const cover = React.createElement('svg', { viewBox: '0 0 400 400' },
    React.createElement('rect', { width: 400, height: 400, fill: '#fb7299' }),
    React.createElement('path', { d: 'M200 300L90 155L310 155Z', fill: '#fff' }));
  const html = render(cover);
  assert.match(html, /viewBox="0 0 400 400"/);
  assert.match(html, /fill="#fb7299"/);
  assert.match(html, /d="M200 300L90 155L310 155Z"/);
  assert.match(html, /gcard cover-ready/);
  assert.doesNotMatch(html, /cover-loading/);
});

test('React image covers keep their own props', () => {
  const html = render(React.createElement('img', { src: '/custom-cover.png', alt: '自选封面' }));
  assert.match(html, /src="\/custom-cover.png"/);
  assert.match(html, /alt="自选封面"/);
});

test('SVG and image descriptors still render normally', () => {
  assert.match(render({ type: 'svg', html: '<svg viewBox="0 0 100 100"><circle r="25"/></svg>' }),
    /<circle r="25"/);
  const html = render({ type: 'img', src: '/remote-cover.jpg', lazy: true });
  assert.match(html, /src="\/remote-cover.jpg"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /cover-loading/);
});
