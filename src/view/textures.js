// Small textures made in code (no files, no canvas, so node can build them too).

import { DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

/** One window cell: a pale wall with a glassy window. Walls tile it; everything else samples the plain corner. */
export function facadeTexture() {
  const S = 32;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      let r = 246;
      let g = 246;
      let b = 244;
      const inWindow = x >= 7 && x < 25 && y >= 6 && y < 26;
      if (inWindow) {
        const edge = x === 7 || x === 24 || y === 6 || y === 25;
        const t = (y - 6) / 20; // brighter toward the top of the pane: sky in the glass
        if (edge) {
          r = 34;
          g = 48;
          b = 70;
        } else {
          r = 40 + 70 * t;
          g = 66 + 80 * t;
          b = 104 + 70 * t;
          if (x - 8 + (y - 7) > 22 && x - 8 + (y - 7) < 27) {
            r += 40;
            g += 40;
            b += 36;
          }
        }
      } else if (y < 3) {
        r = 222;
        g = 222;
        b = 220;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** A glow that is clear inside half its width and fades out beyond it: the halo round a hole's rim. */
export function haloTexture() {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1;
      const dy = (y + 0.5) / S * 2 - 1;
      const rr = Math.hypot(dx, dy);
      let a = 0;
      if (rr >= 0.49 && rr < 1) {
        const k = (rr - 0.49) / 0.51; // 0 at the rim, 1 at the edge
        a = Math.pow(1 - k, 2.2) * 0.85;
        if (rr < 0.52) a *= (rr - 0.49) / 0.03;
      }
      const i = (y * S + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
