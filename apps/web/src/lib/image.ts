'use client';

/**
 * Client-side image processing.
 *
 * Everything the owner uploads is downscaled and re-encoded here, in the
 * browser, before it goes anywhere. Two reasons that matters: a modern phone
 * camera produces four megabytes that nobody needs to look at a salon interior,
 * and in the local demo these pictures land in localStorage beside every
 * booking — so an untouched upload is a way to lose the shop's diary.
 */

function draw(
  img: HTMLImageElement,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  quality: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  paint(ctx);
  const out = canvas.toDataURL('image/webp', quality);
  // Safari used to answer WebP requests with a tiny PNG; a suspiciously short
  // string means the format was refused, so ask for something it will encode.
  return out.length < 40 ? canvas.toDataURL('image/jpeg', quality) : out;
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad_image'));
    };
    img.src = url;
  });
}

/** Logo: cover-fit into a 256px square. */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  const img = await load(file);
  const size = 256;
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  return draw(img, size, size, (ctx) => ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h), 0.85);
}

/**
 * Salon photo: 1000px on the long edge, aspect ratio kept.
 *
 * Wide enough to fill a cover band on a laptop and still look sharp, small
 * enough that six of them do not fill a browser's storage quota. The aspect
 * ratio is preserved rather than cropped to 16:9 here — the gallery does its
 * own cropping in CSS, which means an owner can always change their mind about
 * framing without re-uploading.
 */
export async function fileToPhotoDataUrl(file: File): Promise<string> {
  const img = await load(file);
  const long = Math.max(img.width, img.height);
  const scale = Math.min(1, 1000 / long);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return draw(img, w, h, (ctx) => ctx.drawImage(img, 0, 0, w, h), 0.72);
}
