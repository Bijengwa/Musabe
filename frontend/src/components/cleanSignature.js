// Makes a clean, small signature picture from a drawing or a PHOTO of a signature on paper:
// the paper (light) becomes see-through, the ink becomes dark blue, the empty space around is cut off,
// and it is made at most 360 x 120. Returns a PNG data URL, or null when no ink was found.
export function cleanSignature(source) {
  const w0 = source.naturalWidth || source.width;
  const h0 = source.naturalHeight || source.height;
  const scale = Math.min(1, 1400 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const px = d.data;
  // Light parts of a photo are paper. Find the darkness of the paper first (photos are often grey), then keep only clearly darker ink.
  let sum = 0; let n = 0;
  for (let i = 0; i < px.length; i += 16) { if (px[i + 3] > 0) { sum += (px[i] + px[i + 1] + px[i + 2]) / 3; n += 1; } }
  const paper = n ? sum / n : 255;
  const cut = Math.min(paper - 45, 170);
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const light = (px[i] + px[i + 1] + px[i + 2]) / 3;
      const ink = px[i + 3] > 40 && light < cut;
      if (ink) {
        const a = Math.min(255, Math.round(((cut - light) / Math.max(cut, 1)) * 255 * 1.8) + 90);
        px[i] = 10; px[i + 1] = 42; px[i + 2] = 138; px[i + 3] = a;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      } else px[i + 3] = 0;
    }
  }
  if (maxX < 0) return null;
  g.putImageData(d, 0, 0);
  const pad = 4;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1; const ch = maxY - minY + 1;
  const k = Math.min(1, 360 / cw, 120 / ch);
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
  out.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
