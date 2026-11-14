import { defaultTheme, iconFilters, themeKey, validTheme } from './preferences.js';

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
    await chrome.action.setIcon({ path: Object.fromEntries(sizes.map(size => [size, `icons/${size}.png`])) });
    return;
  }
  const pixels = await Promise.all(sizes.map(size => renderIcon(size, theme)));
  await chrome.action.setIcon({ imageData: Object.fromEntries(pixels) });
}

let pending = Promise.resolve();
function refreshIcon() {
  pending = pending.then(updateIcon).catch(error => console.warn('Could not update the Reel Player icon', error));
}

chrome.runtime.onInstalled.addListener(refreshIcon);
chrome.runtime.onStartup.addListener(refreshIcon);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.hasOwn(changes, themeKey)) refreshIcon();
});
