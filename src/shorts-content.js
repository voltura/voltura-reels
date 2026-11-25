import pageStyles from '../extension/facebook.css';
import { shortsEnabled, shortsPath, watchPath } from '../extension/shorts-access.js';
import { ReelPlayer } from './player.js';
import { adPlayback, findShortsPlayback, findWatchPlayback, youtubePlayer } from './youtube.js';

function watchYouTube() {
  let stop;
  let enabled = false;
  let mountedRoute;
  let lastWatch;

  function updateRoute() {
    const route = enabled ? watchPath(location) ?? (shortsPath(location) && 'shorts') : null;
    if (route === mountedRoute) return;
    stop?.();
    mountedRoute = route;
    stop = route ? mountYouTube(route, () => lastWatch, (reel) => { lastWatch = reel; }) : undefined;
    if (!enabled) lastWatch = undefined;
  }

  navigation.addEventListener('currententrychange', updateRoute);
  let preferenceChanged = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, shortsEnabled)) return;
    preferenceChanged = true;
    enabled = changes[shortsEnabled].newValue === true;
    updateRoute();
  });
  void chrome.storage.local.get(shortsEnabled).then((stored) => {
    if (preferenceChanged) return;
    enabled = stored[shortsEnabled] === true;
    updateRoute();
  }).catch(() => {});
}

function mountYouTube(route, previousWatch, rememberWatch) {
  const watch = route !== 'shorts';
  const viewerSelector = watch ? 'ytd-watch-flexy:not([hidden])' : 'ytd-shorts';
  const wrapperSelector = watch ? '#movie_player' : '#shorts-player';
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(pageStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  let player;
  let viewer;
  let mediaWrapper;
  let pending;
  const observer = new MutationObserver(schedule);
  const adObserver = new MutationObserver(() => {
    if (mediaWrapper?.matches(adPlayback)) destroyPlayer();
    if (watch || !player?.active) schedule();
  });
  const resizeObserver = watch ? new ResizeObserver(schedule) : undefined;

  function destroyPlayer() {
    player?.destroy();
    player = undefined;
  }

  function refresh() {
    pending = undefined;
    const key = watch ? watchPath(location) : shortsPath(location);
    if (!key || (watch && key !== route)) return;

    const nextViewer = document.querySelector(viewerSelector);
    if (nextViewer !== viewer) {
      viewer = nextViewer;
      observer.disconnect();
      observer.observe(viewer ?? document.body, {
        childList: true,
        subtree: true,
        ...(viewer && {
          attributes: true,
          attributeFilter: ['src', 'href', 'hidden', 'aria-hidden', 'aria-disabled', 'aria-pressed',
            'aria-label', 'disabled', 'video-id', 'is-live', 'theater'],
        }),
      });
    }

    const nextWrapper = viewer?.querySelector(wrapperSelector);
    if (nextWrapper !== mediaWrapper) {
      mediaWrapper = nextWrapper;
      adObserver.disconnect();
      resizeObserver?.disconnect();
      if (mediaWrapper) adObserver.observe(mediaWrapper, { attributes: true, attributeFilter: ['class'] });
      if (mediaWrapper) resizeObserver?.observe(mediaWrapper);
    }

    if (mediaWrapper?.matches(adPlayback)) {
      destroyPlayer();
      return;
    }

    const reel = watch ? findWatchPlayback(viewer, key, previousWatch()) : findShortsPlayback(viewer, key);
    if (!reel) {
      player?.waitForPlayback();
      return;
    }
    if (watch) rememberWatch(reel);
    player ??= new ReelPlayer(schedule, youtubePlayer);
    if (player.update(reel) === false) return;
    if (!player.active) {
      const { left, right, top, bottom } = reel.bounds;
      const alongside = left >= 124;
      const x = alongside ? left - 44 : Math.min(innerWidth - 44, right - 44);
      const y = Math.max(watch ? 64 : 8, top + (alongside || watch ? 8 : 60));
      player.host.style.setProperty('--youtube-launch-left', `${Math.max(8, x)}px`);
      player.host.style.setProperty('--youtube-launch-top', `${y}px`);
      player.launch.hidden = Boolean(document.fullscreenElement) || (watch && y + 36 > Math.min(bottom, innerHeight));
    }
  }

  function schedule() {
    if (pending === undefined && !signal.aborted) pending = setTimeout(refresh, 50);
  }

  window.addEventListener('resize', schedule, { signal });
  navigation.addEventListener('currententrychange', schedule, { signal });
  document.addEventListener('yt-navigate-finish', schedule, { signal });
  for (const event of ['scroll', 'loadedmetadata', 'durationchange', 'fullscreenchange']) {
    document.addEventListener(event, schedule, { signal, capture: true, passive: true });
  }
  refresh();

  return () => {
    lifetime.abort();
    clearTimeout(pending);
    observer.disconnect();
    adObserver.disconnect();
    resizeObserver?.disconnect();
    destroyPlayer();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
  };
}

// Registration and injection into already open tabs can meet in the same document.
if (!globalThis.volturaShortsLoaded) {
  globalThis.volturaShortsLoaded = true;
  watchYouTube();
}
