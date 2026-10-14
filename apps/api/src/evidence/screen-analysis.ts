import jpeg from 'jpeg-js';
import { estimateScreenRecaptureRisk, type ScreenRiskResult } from '@pramaan/event-contracts';

/** Decodes a JPEG (bounded memory) and runs the EXPERIMENTAL screen-recapture estimator. */
export function analyseJpeg(
  bytes: Buffer,
): ScreenRiskResult | { experimental: true; error: string } {
  try {
    const img = jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: 50,
      maxMemoryUsageInMB: 512,
      formatAsRGBA: true,
    });
    const luma = new Uint8Array(img.width * img.height);
    for (let i = 0, j = 0; i < luma.length; i++, j += 4) {
      luma[i] = (0.299 * img.data[j]! + 0.587 * img.data[j + 1]! + 0.114 * img.data[j + 2]!) | 0;
    }
    return estimateScreenRecaptureRisk({ width: img.width, height: img.height, data: luma });
  } catch (e) {
    return {
      experimental: true,
      error: `analysis unavailable: ${(e as Error).message.slice(0, 120)}`,
    };
  }
}
