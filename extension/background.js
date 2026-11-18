import { defaultTheme, iconFilters, themeKey, validTheme } from './preferences.js';
import { cropStoryPhoto, facebookPlaybackPage, frameDownload, storyPhotoDownload } from './story-photo.js';

const sizes = [16, 24, 32];

async function renderIcon(size, theme) {
  const response = await fetch(chrome.runtime.getURL(`icons/${size}.png`));
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const context = new OffscreenCanvas(size, size).getContext('2d');
    context.filter = iconFilters[theme];
    context.drawImage(bitmap, 0, 0);
    return [size, context.getImageData(0, 0, size, size)];
  } finally {
    bitmap.close();
  }
}

async function updateIcon() {
  const stored = await chrome.storage.local.get(themeKey);
  const theme = validTheme(stored[themeKey]);
  if (theme === defaultTheme) {
    await chrome.action.setIcon({
      path: Object.fromEntries(sizes.map((size) => [size, `icons/${size}.png`])),
    });
    return;
  }
  const pixels = await Promise.all(sizes.map((size) => renderIcon(size, theme)));
  await chrome.action.setIcon({ imageData: Object.fromEntries(pixels) });
}

let pending = Promise.resolve();
function refreshIcon() {
  pending = pending
    .then(updateIcon)
    .catch((error) => console.warn('Could not update the Reel Player icon', error));
}

chrome.runtime.onInstalled.addListener(refreshIcon);
chrome.runtime.onStartup.addListener(refreshIcon);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.hasOwn(changes, themeKey)) refreshIcon();
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'crop-story-photo') {
    cropStoryPhoto(message, sender).then(respond, () => respond(null));
    return true;
  }
  if (message?.type === 'image-download-status') {
    if (!facebookPlaybackPage(sender) || !Number.isInteger(message.id)) return;
    chrome.downloads.search({ id: message.id }).then(
      ([item]) => respond(item?.byExtensionId === chrome.runtime.id ? item.state : null),
      () => respond(null),
    );
    return true;
  }
  if (!['save-story-photo', 'save-cropped-story-photo', 'save-video-frame'].includes(message?.type)) return;
  const options = message.type === 'save-story-photo'
    ? storyPhotoDownload(message.source, sender)
    : frameDownload(message, sender);
  if (!options) {
    respond(null);
    return;
  }
  chrome.downloads.download(options).then(
    (id) => respond(id),
    () => respond(null),
  );
  return true;
});
