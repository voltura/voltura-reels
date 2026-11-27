export const shortsOrigin = 'https://www.youtube.com';
export const shortsPermission = { origins: [`${shortsOrigin}/*`] };
export const shortsEnabled = 'youtubeShortsEnabled';
export const syncShortsMessage = 'sync-youtube-shorts';
const scriptId = 'youtube-shorts';

export function shortsPath(url) {
  if (url.origin !== shortsOrigin) return null;
  return /^\/shorts\/[\w-]{11}\/?$/.test(url.pathname)
    ? url.pathname.replace(/\/$/, '')
    : null;
}

export function watchPath(url) {
  if (url.origin !== shortsOrigin || url.pathname !== '/watch') return null;
  const id = new URLSearchParams(url.search).get('v');
  return id && /^[\w-]{11}$/.test(id) ? `/watch?v=${id}` : null;
}

export function youtubePlaybackKey(url) {
  return shortsPath(url) ?? watchPath(url);
}

export async function syncShortsAccess(api = chrome) {
  const enabled = await api.permissions.contains(shortsPermission);
  if (!enabled) await api.storage.local.remove(shortsEnabled);

  const scripts = await api.scripting.getRegisteredContentScripts({ ids: [scriptId] });
  if (!enabled) {
    if (scripts.length) await api.scripting.unregisterContentScripts({ ids: [scriptId] });
    return false;
  }

  if (!scripts.length) {
    await api.scripting.registerContentScripts([{
      id: scriptId,
      matches: shortsPermission.origins,
      js: ['shorts.js'],
    }]);
  }
  const stored = await api.storage.local.get(shortsEnabled);
  await api.storage.local.set({ [shortsEnabled]: true });
  if (!scripts.length || !stored[shortsEnabled]) {
    const tabs = await api.tabs.query({ url: shortsPermission.origins });
    // Tabs can close or navigate after the query. Registration covers the next document.
    await Promise.allSettled(tabs.map(({ id }) =>
      api.scripting.executeScript({ target: { tabId: id }, files: ['shorts.js'] }),
    ));
  }
  return true;
}
