/**
 * EXPERIMENTAL screen-recapture risk estimator.
 *
 * Photographs of LCD/OLED screens frequently show moiré: narrow, high-frequency peaks in
 * the spatial spectrum caused by aliasing between the display pixel grid and the camera
 * sensor grid. This module measures how "peaky" the high-frequency spectrum of a
 * luminance image is.
 *
 * LIMITATIONS (also documented in docs/limitations.md):
 *  - Moiré is not unique to screens: fabrics, fences, grilles, printed halftones and
 *    railway platform tiles can produce identical peaks (false positives).
 *  - Many modern high-PPI screens photographed slightly out of focus produce NO moiré
 *    (false negatives).
 *  - Compression, motion blur, low light and camera processing change the result.
 * The score is a review hint in [0,1], never proof of liveness or of fabrication.
 */

export const SCREEN_RISK_METHOD = 'row-col-fft-hf-peakiness-v1';
export const ANALYSIS_SIZE = 256;

export interface LumaImage {
  width: number;
  height: number;
  /** Row-major luminance values 0..255. */
  data: ArrayLike<number>;
}

export interface ScreenRiskResult {
  experimental: true;
  method: string;
  score: number;
  peakiness: number;
  peakFrequency: number;
  highFrequencyEnergyRatio: number;
}

function fftMagnitude(re: Float64Array): Float64Array {
  const n = re.length;
  const im = new Float64Array(n);
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k]!, im[k]!);
  return mag;
}

/** Box-resamples a luminance image to size x size. */
export function resampleLuma(img: LumaImage, size = ANALYSIS_SIZE): Float64Array {
  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / size));
      out[y * size + x] = img.data[sy * img.width + sx] ?? 0;
    }
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function estimateScreenRecaptureRisk(
  img: LumaImage,
  size = ANALYSIS_SIZE,
): ScreenRiskResult {
  if (img.width < 16 || img.height < 16) throw new Error('Image too small for analysis');
  const px = resampleLuma(img, size);
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const acc = new Float64Array(size / 2);
  const lines = 32;
  for (let l = 0; l < lines; l++) {
    const idx = Math.floor(((l + 0.5) * size) / lines);
    for (const dir of [0, 1]) {
      const buf = new Float64Array(size);
      let mean = 0;
      for (let i = 0; i < size; i++) {
        const v = dir === 0 ? px[idx * size + i]! : px[i * size + idx]!;
        buf[i] = v;
        mean += v;
      }
      mean /= size;
      for (let i = 0; i < size; i++) buf[i] = (buf[i]! - mean) * hann[i]!;
      const mag = fftMagnitude(buf);
      for (let k = 0; k < mag.length; k++) acc[k] = acc[k]! + mag[k]!;
    }
  }
  const lo = Math.floor(size / 16);
  const band = Array.from(acc.slice(lo));
  const total = Array.from(acc.slice(1)).reduce((a, b) => a + b, 0) || 1;
  const hfEnergy = Array.from(acc.slice(Math.floor(size / 8))).reduce((a, b) => a + b, 0);
  let peak = 0;
  let peakK = lo;
  band.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakK = i + lo;
    }
  });
  const med = median(band) || 1e-9;
  const peakiness = peak / med;
  // Logistic mapping: peakiness ~4 for natural images, >>20 for strong periodic grids.
  const score = 1 / (1 + Math.exp(-1.6 * (Math.log(peakiness) - Math.log(12))));
  return {
    experimental: true,
    method: SCREEN_RISK_METHOD,
    score: Math.round(score * 1000) / 1000,
    peakiness: Math.round(peakiness * 100) / 100,
    peakFrequency: peakK / size,
    highFrequencyEnergyRatio: Math.round((hfEnergy / total) * 1000) / 1000,
  };
}
