import { shortsOrigin, shortsPath, watchPath, youtubePlaybackKey } from '../extension/shorts-access.js';
import { isEnabled } from './facebook.js';

export const adPlayback = '.ad-showing, .ad-interrupting';
const watchUnavailable = `${adPlayback}, .ytp-live, .ytp-player-minimized`;
const hiddenControl = '[hidden], [inert], [aria-hidden="true"]';
const mainVideo = 'video.html5-main-video';
const shortsRenderer = 'ytd-reel-video-renderer, ytd-reel-video-renderer-cow';
const actionLabels = {
  comments: /^(?:comments|view (?:[\d.,\s]+ )?comments|kommentarer|visa (?:[\d.,\s]+ )?kommentarer)$/i,
  share: /^(share|dela)$/i,
};
const actionIcons = {
  comments: 'M1 6a4 4 0 014-4h14',
  share: 'M10 3.158V7.51c-5.428',
};

function activeShortPath(wrapper) {
  const href = wrapper?.querySelector('a.ytp-title-link[href]')?.href;
  return href && URL.canParse(href) ? shortsPath(new URL(href)) : null;
}

function playbackBounds(wrapper) {
  const bounds = wrapper.getBoundingClientRect();
  if (bounds.width >= 100 && bounds.height >= 100 &&
      bounds.right > 0 && bounds.left < innerWidth &&
      bounds.bottom > 0 && bounds.top < innerHeight) return bounds;
}

export function findShortsPlayback(viewer, key) {
  const wrapper = viewer?.querySelector('#shorts-player');
  const card = wrapper?.closest(shortsRenderer);
  const video = card && wrapper.querySelector(mainVideo);
  if (!video || !video.readyState || !video.videoWidth || activeShortPath(wrapper) !== key ||
      wrapper.matches(adPlayback) || card.closest(hiddenControl) ||
      !card.checkVisibility({ opacityProperty: true, visibilityProperty: !document.fullscreenElement })) return null;

  const bounds = playbackBounds(wrapper);
  if (!bounds) return null;
  return { kind: 'short', key, viewer, wrapper, card, video, source: video.currentSrc, bounds };
}

function currentWatch({ key, viewer, wrapper, video }) {
  if (!wrapper || !video || viewer.closest(`${hiddenControl}, [is-live]`) ||
      key !== `/watch?v=${viewer.getAttribute('video-id')}` || wrapper.matches(watchUnavailable) ||
      !video.readyState || !video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) return false;
  const href = wrapper.querySelector('a.ytp-title-link[href]')?.href;
  const playerKey = href && URL.canParse(href) && watchPath(new URL(href));
  return !playerKey || playerKey === key;
}

export function findWatchPlayback(viewer, key, previous) {
  const wrapper = viewer?.querySelector('#movie_player');
  const video = wrapper?.querySelector(mainVideo);
  if (!currentWatch({ key, viewer, wrapper, video })) return null;
  if (previous && previous.key !== key && previous.video === video && previous.source === video.currentSrc) return null;
  if (!wrapper.checkVisibility({ opacityProperty: true, visibilityProperty: !document.fullscreenElement })) return null;
  const bounds = playbackBounds(wrapper);
  if (!bounds) return null;
  return { kind: 'video', key, viewer, wrapper, video, source: video.currentSrc, bounds };
}

function actionBarButton(buttons, action) {
  for (const item of buttons ?? []) {
    const label = item.getAttribute('aria-label');
    const path = item.querySelector('svg path')?.getAttribute('d');
    if (actionLabels[action].test(label) || path?.startsWith(actionIcons[action]) ||
        item.querySelector(`yt-icon[icon="${action}" i]`)) return item;
  }
}

function shortControl({ viewer, card }, action) {
  switch (action) {
    case 'previous':
      return viewer.querySelector('#navigation-button-up button');
    case 'next':
      return viewer.querySelector('#navigation-button-down button');
    case 'like':
      return card.querySelector('like-button-view-model button[aria-pressed], #like-button button[aria-pressed]');
    case 'dislike':
      return card.querySelector('dislike-button-view-model button[aria-pressed], #dislike-button button[aria-pressed]');
    case 'comments':
    case 'share':
      return card.querySelector(`#${action}-button button`) ??
        actionBarButton(card.querySelectorAll('reel-action-bar-view-model > button-view-model button'), action);
    case 'captions':
      return card.querySelector('#closed-captioning-button-container button, ytm-closed-captioning-button button');
    case 'subscribe':
      return card.querySelector('yt-subscribe-button-view-model button, #subscribe-button button');
  }
}

function watchControl({ viewer, wrapper }, action) {
  switch (action) {
    case 'captions':
      return wrapper.querySelector('.ytp-subtitles-button');
    case 'comments': {
      const button = viewer.querySelector('ytd-watch-metadata #comments-button button');
      if (button) return button;
      const thread = viewer.querySelector('ytd-comments#comments');
      if (thread && (!thread.querySelector('ytd-message-renderer') || thread.querySelector('ytd-comments-header-renderer')))
        return thread;
      return;
    }
    case 'like':
    case 'dislike':
      return viewer.querySelector(
        `ytd-watch-metadata ${action}-button-view-model button[aria-pressed], ` +
        `ytd-watch-metadata #${action}-button button[aria-pressed]`,
      );
    case 'share':
      return viewer.querySelector('ytd-watch-metadata #share-button button') ??
        actionBarButton(viewer.querySelectorAll('ytd-watch-metadata #actions button'), action);
    case 'subscribe':
      return viewer.querySelector('ytd-watch-metadata #subscribe-button button, ytd-watch-metadata yt-subscribe-button-view-model button');
  }
}

function visibleControl(reel, action) {
  const watch = reel.kind === 'video';
  const target = watch ? watchControl(reel, action) : shortControl(reel, action);
  if (!target || target.closest(hiddenControl)) return;
  // YouTube can collapse the Watch metadata below the video when fullscreen changes.
  if ((watch && action !== 'captions') || target.getClientRects().length) return target;
}

function metadata(reel) {
  const watch = reel.kind === 'video';
  const overlay = watch ? reel.viewer.querySelector('ytd-watch-metadata')
    : reel.card.querySelector('yt-reel-player-overlay-view-model') ?? reel.card;
  const creator = overlay?.querySelector(watch ? '#owner a[href^="/@"], #owner a[href^="/channel/"]'
    : 'a[href^="/@"], a[href^="/channel/"]');
  const owner = creator?.textContent.trim() || creator?.getAttribute('aria-label') || '';
  const profile = creator?.href.startsWith(`${shortsOrigin}/`) ? creator.href : undefined;
  const title = overlay?.querySelector(watch ? 'h1 yt-formatted-string, h1'
    : 'yt-short-description-view-model, ytd-reel-player-header-renderer #title');
  const subscribe = visibleControl(reel, 'subscribe');
  const followControl = isEnabled(subscribe) ? subscribe : undefined;
  const follow = followControl?.textContent.trim() || followControl?.getAttribute('aria-label') || '';
  return { owner, profile, follow, followControl, caption: { text: title?.textContent.trim() ?? '', links: [] } };
}

export const youtubePlayer = {
  control: visibleControl,
  liked: (button) => button?.getAttribute('aria-pressed') === 'true',
  playbackKey: youtubePlaybackKey,
  isCurrent(reel) {
    if (reel.kind === 'video') {
      return reel.viewer.querySelector('#movie_player') === reel.wrapper &&
        reel.wrapper.querySelector(mainVideo) === reel.video && currentWatch(reel);
    }
    return reel.wrapper.closest(shortsRenderer) === reel.card &&
      !reel.wrapper.matches(adPlayback) && activeShortPath(reel.wrapper) === reel.key;
  },
  canLikeInFullscreen: () => Boolean(document.querySelector('ytd-masthead #avatar-btn')),
  metadata,
  activate(target) {
    if (target.localName === 'ytd-comments') target.scrollIntoView({ block: 'start' });
    else target.click();
  },
  mute(reel) {
    const button = (reel.card ?? reel.wrapper).querySelector(
      '#mute-button-shape button, #mute-button button, .ytp-mute-button',
    );
    return isEnabled(button) ? { button, muted: reel.video.muted } : null;
  },
};
