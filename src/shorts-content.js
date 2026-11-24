import pageStyles from '../extension/facebook.css';
import { shortsEnabled, shortsPath } from '../extension/shorts-access.js';
import { ReelPlayer } from './player.js';
import { findShortsPlayback, youtubePlayer } from './youtube.js';

function watchShorts() {
  let stop;
  let enabled = false;

  function updateRoute() {
    const key = enabled && shortsPath(location);
    if (key && !stop) stop = mountShorts();
    if (!key && stop) {
      stop();
      stop = undefined;
    }
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

function mountShorts() {
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
    if (mediaWrapper?.matches('.ad-showing, .ad-interrupting') || !player?.active) schedule();
  });

  function refresh() {
    pending = undefined;
    const key = shortsPath(location);
    if (!key) return;

    const nextViewer = document.querySelector('ytd-shorts');
    if (nextViewer !== viewer) {
      viewer = nextViewer;
      observer.disconnect();
      observer.observe(viewer ?? document.body, {
        childList: true,
        subtree: true,
        ...(viewer && {
          attributes: true,
          attributeFilter: ['src', 'href', 'hidden', 'aria-hidden', 'aria-disabled', 'aria-pressed', 'aria-label', 'disabled'],
        }),
      });
    }

    const nextWrapper = viewer?.querySelector('#shorts-player');
    if (nextWrapper !== mediaWrapper) {
      mediaWrapper = nextWrapper;
      adObserver.disconnect();
      if (mediaWrapper) adObserver.observe(mediaWrapper, { attributes: true, attributeFilter: ['class'] });
    }

    if (mediaWrapper?.matches('.ad-showing, .ad-interrupting')) {
      player?.destroy();
      player = undefined;
      return;
    }

    const reel = findShortsPlayback(viewer, key);
    if (!reel) {
      player?.waitForPlayback();
      return;
    }
    player ??= new ReelPlayer(schedule, youtubePlayer);
    if (player.update(reel) === false) return;
    if (!player.active) {
      const { left, right, top } = reel.bounds;
      const alongside = left >= 168;
      const x = alongside ? left - 92 : Math.min(innerWidth - 92, right - 92);
      player.host.style.setProperty('--shorts-launch-left', `${Math.max(8, x)}px`);
      player.host.style.setProperty('--shorts-launch-top', `${Math.max(8, top + (alongside ? 8 : 60))}px`);
      player.launch.hidden = Boolean(document.fullscreenElement);
    }
  }

  function schedule() {
    if (pending === undefined && !signal.aborted) pending = setTimeout(refresh, 50);
  }

  window.addEventListener('resize', schedule, { signal });
  navigation.addEventListener('currententrychange', schedule, { signal });
  document.addEventListener('yt-navigate-finish', schedule, { signal });
  for (const event of ['scroll', 'loadedmetadata', 'fullscreenchange']) {
    document.addEventListener(event, schedule, { signal, capture: true, passive: true });
  }
  refresh();

  return () => {
    lifetime.abort();
    clearTimeout(pending);
    observer.disconnect();
    adObserver.disconnect();
    player?.destroy();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
  };
}

// Registration and injection into already open tabs can meet in the same document.
if (!globalThis.volturaShortsLoaded) {
  globalThis.volturaShortsLoaded = true;
  watchShorts();
}
