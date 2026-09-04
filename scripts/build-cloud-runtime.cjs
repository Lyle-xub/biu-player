// Build-time downloads only. The installed app runs this relocatable environment offline.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const root = path.resolve(__dirname, '..');
const target = `${process.platform}-${process.arch}`;
const distributions = {
  'darwin-arm64': {
    triple: 'aarch64-apple-darwin',
    pythonHash: '81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b',
    ffmpegUrl: 'https://files.pythonhosted.org/packages/40/5c/f3d8a657d362cc93b81aab8feda487317da5b5d31c0e1fdfd5e986e55d17/imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl',
    ffmpegHash: 'b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742',
  },
  'win32-x64': {
    triple: 'x86_64-pc-windows-msvc',
    pythonHash: '7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14',
    ffmpegUrl: 'https://files.pythonhosted.org/packages/2c/c6/fa760e12a2483469e2bf5058c5faff664acf66cadb4df2ad6205b016a73d/imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl',
    ffmpegHash: '02fa47c83703c37df6bfe4896aab339013f62bf02c5ebf2dce6da56af04ffc0a',
  },
};
const selected = distributions[target];
if (!selected) throw new Error(`Unsupported cloud runtime target: ${target}`);
const windows = process.platform === 'win32';
const output = path.join(root, 'dist/cloud-runtime');
const cache = path.join(root, 'dist/runtime-downloads');
const pythonUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-${selected.triple}-install_only_stripped.tar.gz`;
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: 'inherit', windowsHide: true });

async function download(url, name, hash) {
  const file = path.join(cache, name);
  if (fs.existsSync(file) && sha256(file) === hash) return file;
  console.log(`Downloading ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${file}.part`));
  if (sha256(`${file}.part`) !== hash) throw new Error(`Checksum mismatch: ${name}`);
  fs.renameSync(`${file}.part`, file);
  return file;
}

async function main() {
  fs.mkdirSync(cache, { recursive: true });
  const pythonArchive = await download(pythonUrl, `python-${target}.tar.gz`, selected.pythonHash);
  const ffmpegArchive = await download(selected.ffmpegUrl, path.basename(selected.ffmpegUrl), selected.ffmpegHash);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  run('tar', ['-xzf', pythonArchive, '-C', output]);
  const python = path.join(output, windows ? 'python/python.exe' : 'python/bin/python3');
  const args = ['-E', '-s', '-B', '-X', 'utf8'];
  const packages = path.join(output, windows ? 'python/Lib/site-packages' : 'python/lib/python3.12/site-packages');
  run(python, [...args, '-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', '--no-compile',
    '--platform', windows ? 'win_amd64' : 'macosx_11_0_arm64', '--target', packages, '-r', 'cloud-video/requirements.txt']);
  run(python, [...args, '-c', `
import pathlib, shutil, sys, zipfile
out = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as wheel:
    binary = next(n for n in wheel.namelist() if n.startswith('imageio_ffmpeg/binaries/ffmpeg-'))
    exe = out / ('ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg')
    exe.write_bytes(wheel.read(binary)); exe.chmod(0o755)
    for name in wheel.namelist():
        if 'LICENSE' in name.upper() or 'COPYING' in name.upper():
            dest = out / 'licenses' / pathlib.Path(name).name
            dest.parent.mkdir(exist_ok=True); dest.write_bytes(wheel.read(name))
# Remove build-only tools and absolute-path launchers; retain dependency licenses.
for name in ['bin', 'Scripts']:
    folder = out / 'python' / name
    if folder.exists():
        for item in folder.iterdir():
            if not item.name.startswith('python'):
                item.unlink() if not item.is_dir() else shutil.rmtree(item)
for folder in (out / 'python').rglob('__pycache__'):
    shutil.rmtree(folder)
packages = out / 'python' / ('Lib/site-packages' if sys.platform == 'win32' else 'lib/python3.12/site-packages')
for name in ['bin', 'Scripts']:
    shutil.rmtree(packages / name, ignore_errors=True)
shutil.rmtree(packages / 'pip', ignore_errors=True)
for folder in list(packages.rglob('tests')):
    if folder.is_dir(): shutil.rmtree(folder)
for archive in (out / 'python').rglob('*.a'):
    archive.unlink()
`, ffmpegArchive, output]);
  if (windows) {
    // The command is a fixed repository script; no user text is interpolated.
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'scripts\\build-windows-native.cmd']);
    fs.copyFileSync(path.join(root, 'dist/windows-native/wirehair.dll'), path.join(output, 'wirehair.dll'));
  } else {
    run('c++', ['-std=c++11', '-O2', '-dynamiclib', '-Wl,-install_name,@rpath/libwirehair.dylib', '-I', 'cloud-video',
      ...['wirehair.cpp', 'WirehairCodec.cpp', 'WirehairTools.cpp', 'gf256.cpp'].map(f => `cloud-video/wirehair/${f}`),
      '-o', path.join(output, 'libwirehair.dylib')]);
  }
  fs.writeFileSync(path.join(output, 'components.json'), JSON.stringify({
    target, python: { version: '3.12.14', url: pythonUrl, sha256: selected.pythonHash },
    ffmpeg: { url: selected.ffmpegUrl, sha256: selected.ffmpegHash,
      source: 'https://github.com/imageio/imageio-ffmpeg', binaries: 'https://github.com/imageio/imageio-binaries' },
    requirements: fs.readFileSync(path.join(root, 'cloud-video/requirements.txt'), 'utf8'),
  }, null, 2) + '\n');
  const ffmpeg = path.join(output, windows ? 'ffmpeg.exe' : 'ffmpeg');
  fs.writeFileSync(path.join(output, 'licenses/FFmpeg.txt'), execFileSync(ffmpeg, ['-hide_banner', '-L'], { encoding: 'utf8', windowsHide: true }));
  for (const [name, hash] of [
    ['COPYING.GPLv2', '8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643'],
    ['COPYING.GPLv3', '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'],
  ]) {
    const license = await download(`https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1/${name}`, name, hash);
    fs.copyFileSync(license, path.join(output, 'licenses', name));
  }
  await Promise.all(['LICENSE', ...['bdb', 'bzip2', 'cpython', 'expat', 'libedit', 'libffi', 'liblzma',
    'mpdecimal', 'ncurses', 'openssl-3', 'sqlite', 'tcl', 'tix', 'zlib'].map(name => `LICENSE.${name}.txt`)].map(async name => {
    const response = await fetch(`https://raw.githubusercontent.com/astral-sh/python-build-standalone/20260901/${name}`);
    if (!response.ok) throw new Error(`Cannot fetch Python license: ${name}`);
    fs.writeFileSync(path.join(output, 'licenses', `Python-${name}`), await response.text());
  }));
  const { createVideoRuntime } = require('../cloud-video-runtime');
  await createVideoRuntime({ source: path.join(root, 'cloud-video'), runtime: output }).ensure();
  console.log(`Cloud runtime ready: ${target}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
