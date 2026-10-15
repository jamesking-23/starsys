// Regenerates every app icon from build/icon.svg (large sizes) and build/icon-small.svg (16-48px).
// Usage:  npx electron scripts/generate-icons.cjs        (add --no-sandbox when running as root/CI)
// Outputs: build/icon.ico, build/icon.png, public/favicon.svg, public/favicon-32.png, public/apple-touch-icon.png
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bigSvg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');
const smallSvg = fs.readFileSync(path.join(root, 'build/icon-small.svg'), 'utf8');
// Embedded as a data URI so the render page is fully self-contained.
const fontUrl = 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'node_modules/@fontsource/archivo/files/archivo-latin-700-normal.woff2')).toString('base64');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_MAX = 48; // up to this size use the simplified seal

async function render(win, svg, size, bg) {
    const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:Archivo;font-weight:700;src:url("${fontUrl}") format("woff2")}
    html,body{margin:0;padding:0;background:${bg};overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style>${svg.replace(/<svg /, '<svg width="' + size + '" height="' + size + '" ')}`;
  win.setContentSize(size, size);
  const tmp = path.join(require('os').tmpdir(), 'starsys-icon-render.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript('Promise.race([document.fonts.load("700 20px Archivo").then(()=>document.fonts.ready), new Promise(r=>setTimeout(r,3000))])').catch(()=>{});
  await new Promise(r => setTimeout(r, 150));
  let img = await win.webContents.capturePage();
  const s = img.getSize();
  if (s.width !== size) img = img.resize({ width: size, height: size, quality: 'best' });
  return img.toBitmap(); // BGRA
}

// Render over white and over black, then recover true alpha (clean anti-aliased transparent corners).
async function renderTransparent(win, svg, size) {
  const w = await render(win, svg, size, '#ffffff');
  const b = await render(win, svg, size, '#000000');
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    let a = 0;
    for (let c = 0; c < 3; c++) a += 255 - (w[o + c] - b[o + c]);
    a = Math.max(0, Math.min(255, a / 3));
    for (let c = 0; c < 3; c++) out[o + c] = a > 0 ? Math.max(0, Math.min(255, (b[o + c] * 255) / a)) : 0;
    out[o + 3] = a;
  }
  return nativeImage.createFromBitmap(out, { width: size, height: size }).toPNG();
}

function buildIco(frames) { // frames: [{size, png}]  (PNG-compressed ICO entries, supported by Windows Vista+)
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + dir.length;
  frames.forEach((f, i) => {
    const o = i * 16;
    dir[o] = f.size >= 256 ? 0 : f.size; dir[o + 1] = f.size >= 256 ? 0 : f.size;
    dir[o + 2] = 0; dir[o + 3] = 0; dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(f.png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += f.png.length;
  });
  return Buffer.concat([head, dir, ...frames.map(f => f.png)]);
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
setTimeout(() => { console.error('generate-icons: timed out'); app.exit(1); }, 120000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, useContentSize: true, frame: false,
    webPreferences: { offscreen: false, sandbox: false } });
  const pick = (s) => (s <= SMALL_MAX ? smallSvg : bigSvg);
  const frames = [];
  for (const s of ICO_SIZES) frames.push({ size: s, png: await renderTransparent(win, pick(s), s) });
  fs.writeFileSync(path.join(root, 'build/icon.ico'), buildIco(frames));
  fs.writeFileSync(path.join(root, 'build/icon.png'), await renderTransparent(win, bigSvg, 512));
  fs.writeFileSync(path.join(root, 'public/favicon-32.png'), frames.find(f => f.size === 32).png);
  fs.writeFileSync(path.join(root, 'public/apple-touch-icon.png'), await renderTransparent(win, bigSvg, 180));
  fs.copyFileSync(path.join(root, 'build/icon-small.svg'), path.join(root, 'public/favicon.svg'));
  // contact sheet for eyeballing (not committed)
  fs.writeFileSync('/tmp/icon-256.png', frames.find(f => f.size === 256).png);
  fs.writeFileSync('/tmp/icon-32.png', frames.find(f => f.size === 32).png);
  fs.writeFileSync('/tmp/icon-16.png', frames.find(f => f.size === 16).png);
  console.log('icons generated:', ICO_SIZES.join(','), 'px');
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
