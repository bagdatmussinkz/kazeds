// QR code generator — uses vendored qrcode-generator library (battle-tested)
// Produces SVG data URL (no canvas required, works in service worker)

import qrcode from "./vendor/qrcode-generator.js";

/**
 * Generate QR code as SVG data URL.
 * @param {string} text - Text to encode
 * @param {number} [size=280] - Output image size in pixels
 * @param {string} [ecc="M"] - Error correction level: L | M | Q | H
 * @returns {string} data:image/svg+xml;base64,...
 */
export function generateQRDataURL(text, size = 280, ecc = "M") {
  const qr = qrcode(0, ecc); // 0 = auto version
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const margin = 4; // quiet zone (QR spec)
  const cellSize = Math.max(1, Math.floor(size / (moduleCount + margin * 2)));
  const total = (moduleCount + margin * 2) * cellSize;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">`;
  svg += `<rect width="${total}" height="${total}" fill="#fff"/>`;

  // Merge consecutive dark cells per row into single rects
  for (let y = 0; y < moduleCount; y++) {
    let x = 0;
    while (x < moduleCount) {
      if (qr.isDark(y, x)) {
        let run = 1;
        while (x + run < moduleCount && qr.isDark(y, x + run)) run++;
        const px = (x + margin) * cellSize;
        const py = (y + margin) * cellSize;
        svg += `<rect x="${px}" y="${py}" width="${run * cellSize}" height="${cellSize}" fill="#000"/>`;
        x += run;
      } else {
        x++;
      }
    }
  }
  svg += "</svg>";

  return "data:image/svg+xml;base64," + btoa(svg);
}
