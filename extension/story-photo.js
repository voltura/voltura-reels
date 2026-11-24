import { refineStoryCrop } from './story-crop.js';
import { shortsPath } from './shorts-access.js';

const facebookOrigin = /^https:\/\/(?:www\.)?facebook\.com$/;

export function facebookPlaybackPage(sender) {
  if (sender.frameId !== 0 || !URL.canParse(sender.url)) return null;
  const page = new URL(sender.url);
  if (!facebookOrigin.test(page.origin)) return null;
  if (/^\/stories\/\d+(?:\/[^/]+)?\/?$/.test(page.pathname)) return { page, kind: 'story' };
  if (/^\/reels?(?:\/\d+)?\/?$/.test(page.pathname)) return { page, kind: 'reel' };
  return null;
}

export function storyPhotoDownload(source, sender) {
  if (typeof source !== 'string' || facebookPlaybackPage(sender)?.kind !== 'story') return null;
  let photo;
  try {
    photo = new URL(source);
  } catch {
    return null;
  }
  const trustedSource = facebookOrigin.test(photo.origin) || /^https:\/\/[\w.-]+\.fbcdn\.net$/.test(photo.origin);
  if (!trustedSource || photo.username || photo.password) return null;
  const extension = /\.(avif|gif|jpe?g|png|webp)$/i.exec(photo.pathname)?.[1];
  return {
    url: photo.href,
    ...(extension && { filename: `facebook-story.${extension.toLowerCase()}` }),
    conflictAction: 'uniquify',
  };
}

export function imageDownloadPage(sender) {
  const facebook = facebookPlaybackPage(sender);
  if (facebook) return facebook;
  if (sender.frameId !== 0 || !URL.canParse(sender.url)) return null;
  const page = new URL(sender.url);
  return shortsPath(page) ? { page, kind: 'short' } : null;
}

export async function cropStoryPhoto({ source, crop }, sender) {
  const photo = storyPhotoDownload(source, sender);
  if (!photo || !Array.isArray(crop) || crop.length !== 4 ||
      !crop.every((edge) => Number.isFinite(edge) && edge >= 0 && edge <= 1)) return null;
  const [left, top, right, bottom] = crop;
  if (left >= right || top >= bottom) return null;

  const response = await fetch(photo.url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  const image = await response.blob();
  if (!/^image\/(?:avif|gif|jpeg|png|webp)$/.test(image.type)) return null;
  const pixels = await createImageBitmap(image);
  try {
    const x = Math.round(left * pixels.width);
    const y = Math.round(top * pixels.height);
    const width = Math.round(right * pixels.width) - x;
    const height = Math.round(bottom * pixels.height) - y;
    if (width < 1 || height < 1) return null;
    const sample = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    sample.drawImage(pixels, x, y, width, height, 0, 0, width, height);
    const refined = refineStoryCrop(sample.getImageData(0, 0, width, height));
    const canvas = new OffscreenCanvas(refined.width, refined.height);
    const context = canvas.getContext('2d');
    if (refined.mask) {
      const mask = refined.mask;
      context.roundRect(mask.x - refined.x, mask.y - refined.y, mask.width, mask.height, mask.radii);
      context.clip();
    }
    context.drawImage(sample.canvas, -refined.x, -refined.y);
    const output = await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',', 2)[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(output);
    });
  } finally {
    pixels.close();
  }
}

export function frameDownload({ type, source, time }, sender) {
  const view = imageDownloadPage(sender);
  if (!view || typeof source !== 'string') return null;
  const prefix = `blob:${view.page.origin}/`;
  if (!source.startsWith(prefix) || !/^[a-f\d-]{36}$/i.test(source.slice(prefix.length))) return null;
  if (type === 'save-cropped-story-photo') {
    if (view.kind !== 'story') return null;
    return { url: source, filename: 'facebook-story.png', conflictAction: 'uniquify' };
  }
  if (typeof time !== 'string' || !/^\d+m\d{2}\.\d$/.test(time)) return null;
  return { url: source, filename: `${view.kind}-${time}.png`, conflictAction: 'uniquify' };
}
