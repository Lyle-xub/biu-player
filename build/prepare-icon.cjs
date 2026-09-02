// Format the supplied brand image as a transparent app icon without redrawing it.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PNG } = require('pngjs');
const source = process.argv[2];
if (!source) throw new Error('Usage: node build/prepare-icon.cjs <original-icon.png>');
const png = PNG.sync.read(fs.readFileSync(source));
const { width, height, data } = png;
const visited = new Uint8Array(width * height);
const pending = [];
const enqueue = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const pixel = y * width + x;
  if (visited[pixel]) return;
  visited[pixel] = 1;
  const i = pixel * 4;
  const max = Math.max(data[i], data[i + 1], data[i + 2]);
  const min = Math.min(data[i], data[i + 1], data[i + 2]);
  // Only exterior neutral pixels connected to the image edge; never touch the artwork.
  if (max - min > 16 || min >= 248) return;
  pending.push(pixel);
};
for (let x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y); }
for (let cursor = 0; cursor < pending.length; cursor++) {
  const pixel = pending[cursor], x = pixel % width, y = Math.floor(pixel / width), i = pixel * 4;
  // Undo the black matte at anti-aliased white-tile edges; preserve fractional alpha.
  const brightness = Math.max(data[i], data[i + 1], data[i + 2]);
  data[i + 3] = brightness < 24 ? 0 : brightness;
  data[i] = data[i + 1] = data[i + 2] = 255;
  enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
}
const output = path.join(__dirname, 'icon.png');
fs.writeFileSync(output, PNG.sync.write(png));
execFileSync('sips', ['-z', '1024', '1024', output, '--out', output], { stdio: 'ignore' });
fs.copyFileSync(output, path.join(__dirname, '../renderer/assets/icon.png'));
console.log(`Prepared matching RGBA application and runtime icons; cleaned ${pending.length} exterior pixels.`);
