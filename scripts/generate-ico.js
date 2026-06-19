'use strict';

// Generates assets/icon.ico from assets/icon.png using png2icons.
// png2icons writes proper BMP-format (BITMAPINFOHEADER) ICO entries —
// the format rcedit requires to embed the icon into the Windows exe.
// PNG-in-ICO entries (produced by png-to-ico and PowerShell System.Drawing)
// are silently rejected by rcedit, leaving the Electron default icon.

const png2icons = require('png2icons');
const path      = require('path');
const fs        = require('fs');

const src  = path.join(__dirname, '../assets/icon.png');
const dest = path.join(__dirname, '../assets/icon.ico');

const input  = fs.readFileSync(src);
const output = png2icons.createICO(input, png2icons.BILINEAR, 0, true);

if (!output) {
  console.error('png2icons failed to generate icon.ico');
  process.exit(1);
}

fs.writeFileSync(dest, output);
console.log(`icon.ico written (${output.length} bytes)`);
