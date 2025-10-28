#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  try {
    const root = path.resolve(__dirname, '..');
    const srcSvg = path.join(root, 'icons', 'icon.svg');
    const outDir = path.join(root, 'icons');
    if (!fs.existsSync(srcSvg)) {
      console.error('SVG not found:', srcSvg);
      process.exit(1);
    }
    const sizes = [16, 24, 32, 48, 128];
    const svgData = fs.readFileSync(srcSvg);
    await Promise.all(sizes.map(async (size) => {
      const out = path.join(outDir, `icon-${size}.png`);
      await sharp(svgData, { density: 384 }) // high density for crisp downscale
        .resize(size, size, { fit: 'contain' })
        .png({ compressionLevel: 9 })
        .toFile(out);
      console.log('generated', path.relative(root, out));
    }));
    console.log('done');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
