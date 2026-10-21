const sharp = require("C:/Users/Admin/Desktop/QoderAPPs/Whatsapp Bot/vocero-src/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp");
const fs = require("fs");
const path = require("path");

const SRC = "C:/Users/Admin/Downloads/RAE Marketing Services Logo(2) (1).png";
const OUT = "C:/Users/Admin/Desktop/QoderAPPs/Whatsapp Bot/vocero-src/public/brand";

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const img = sharp(SRC).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x, y) => (y * width + x) * channels;

  const flooded = new Uint8Array(width * height);
  const stack = [];
  const isBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return Math.min(r, g, b) >= 235;
  };
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    const p = y * width + x;
    if (!flooded[p] && isBg(at(x, y))) { flooded[p] = 1; stack.push(p); }
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width, y = (p / width) | 0;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = ny * width + nx;
      if (flooded[q]) continue;
      if (isBg(at(nx, ny))) { flooded[q] = 1; stack.push(q); }
    }
  }
  // Segunda pasada: quita el halo anti-alias pegado al fondo recortado.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (flooded[p]) continue;
      const i = at(x, y);
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 210) continue;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      if (nb.some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height && flooded[ny * width + nx])) {
        flooded[p] = 1;
      }
    }
  }
  for (let p = 0; p < width * height; p++) {
    if (flooded[p]) data[at(p % width, (p / width) | 0) + 3] = 0;
  }

  const trimmed = sharp(Buffer.from(data), { raw: { width, height, channels } })
    .trim()
    .png();
  const buf = await trimmed.toBuffer();

  for (const size of [512, 192, 64]) {
    await sharp(buf).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, size === 512 ? "rae-logo.png" : `rae-logo-${size}.png`));
  }
  const b64 = fs.readFileSync(path.join(OUT, "rae-logo-64.png")).toString("base64");
  fs.writeFileSync(path.join(OUT, "rae-logo-64.b64"), b64);
  console.log("ok", buf.length, "b64 len", b64.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
