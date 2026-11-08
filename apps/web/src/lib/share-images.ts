'use client';
/**
 * Images people share: a level card for Instagram/WhatsApp stories, and a
 * business's counter sticker and story template with its booking QR code.
 * Drawn on a canvas in the browser — no server, no upload.
 */

const INK = '#1f1a24';
const ROSE = '#c2416b';
const CREAM = '#fff7f2';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('no_canvas');
  return [c, g];
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, opts: { color?: string; weight?: number; maxWidth?: number } = {}) {
  g.fillStyle = opts.color ?? INK;
  g.font = `${opts.weight ?? 600} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let t = s;
  if (opts.maxWidth) while (t.length > 3 && g.measureText(t).width > opts.maxWidth) t = t.slice(0, -2);
  if (t !== s) t = t.slice(0, -1) + '…';
  g.fillText(t, x, y);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

async function qrData(url: string): Promise<string> {
  const QR = await import('qrcode');
  return QR.toDataURL(url, { width: 900, margin: 1, color: { dark: INK, light: '#ffffff' } });
}

function gradient(g: CanvasRenderingContext2D, w: number, h: number) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#fde2e4');
  gr.addColorStop(1, '#e8e0ff');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}

/** 1080×1920 story card: "I'm Gold on StyleNow" + invite link. */
export async function levelCardPng(o: { emoji: string; levelName: string; headline: string; points: string; cta: string; link: string }): Promise<string> {
  const [c, g] = canvas(1080, 1920);
  gradient(g, 1080, 1920);
  text(g, 'StyleNow', 540, 200, 64, { color: ROSE, weight: 800 });
  text(g, o.emoji || '✨', 540, 640, 300, {});
  text(g, o.headline, 540, 930, 70, { weight: 800, maxWidth: 960 });
  text(g, o.levelName, 540, 1040, 110, { color: ROSE, weight: 900, maxWidth: 960 });
  text(g, o.points, 540, 1160, 44, { weight: 500, maxWidth: 960 });
  const qr = await loadImage(await qrData(o.link));
  g.fillStyle = '#fff';
  g.fillRect(390, 1300, 300, 300);
  g.drawImage(qr, 400, 1310, 280, 280);
  text(g, o.cta, 540, 1690, 46, { weight: 700, maxWidth: 980 });
  return c.toDataURL('image/png');
}

/** A6-ish counter sticker (1240×1748, prints at ~300 dpi on A6). */
export async function stickerPng(o: { shopName: string; title: string; sub: string; link: string }): Promise<string> {
  const [c, g] = canvas(1240, 1748);
  g.fillStyle = CREAM;
  g.fillRect(0, 0, 1240, 1748);
  g.strokeStyle = ROSE;
  g.lineWidth = 16;
  g.strokeRect(40, 40, 1160, 1668);
  text(g, o.shopName, 620, 220, 84, { weight: 800, maxWidth: 1080 });
  text(g, o.title, 620, 360, 70, { color: ROSE, weight: 800, maxWidth: 1080 });
  const qr = await loadImage(await qrData(o.link));
  g.drawImage(qr, 220, 470, 800, 800);
  text(g, o.sub, 620, 1380, 48, { weight: 500, maxWidth: 1080 });
  text(g, 'StyleNow', 620, 1560, 64, { color: ROSE, weight: 800 });
  return c.toDataURL('image/png');
}

/** 1080×1920 Instagram/WhatsApp story with the booking QR. */
export async function storyPng(o: { shopName: string; title: string; sub: string; link: string }): Promise<string> {
  const [c, g] = canvas(1080, 1920);
  gradient(g, 1080, 1920);
  text(g, o.shopName, 540, 330, 88, { weight: 800, maxWidth: 980 });
  text(g, o.title, 540, 470, 66, { color: ROSE, weight: 800, maxWidth: 980 });
  const qr = await loadImage(await qrData(o.link));
  g.fillStyle = '#fff';
  g.fillRect(230, 640, 620, 620);
  g.drawImage(qr, 250, 660, 580, 580);
  text(g, o.sub, 540, 1380, 46, { weight: 500, maxWidth: 980 });
  text(g, 'StyleNow', 540, 1700, 60, { color: ROSE, weight: 800 });
  return c.toDataURL('image/png');
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Share through the phone's share sheet when it takes files; otherwise download. */
export async function shareImage(dataUrl: string, name: string, shareText: string): Promise<'shared' | 'downloaded'> {
  try {
    const file = await dataUrlToFile(dataUrl, name);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: shareText });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'shared'; // the person closed the sheet
  }
  download(dataUrl, name);
  return 'downloaded';
}

/** Share text + link (and optionally a photo the person picked). Falls back to WhatsApp. */
export async function shareLink(o: { text: string; url: string; photo?: File | null }): Promise<void> {
  try {
    if (o.photo && navigator.canShare?.({ files: [o.photo] })) {
      await navigator.share({ files: [o.photo], text: `${o.text} ${o.url}` });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text: o.text, url: o.url });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${o.text} ${o.url}`)}`, '_blank', 'noopener');
}
