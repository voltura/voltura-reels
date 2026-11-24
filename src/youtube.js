import { shortsOrigin, shortsPath } from '../extension/shorts-access.js';
import { isEnabled } from './facebook.js';

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

export function findShortsPlayback(viewer, key) {
  const wrapper = viewer?.querySelector('#shorts-player');
  const card = wrapper?.closest('ytd-reel-video-renderer');
  const video = card && wrapper.querySelector('video.html5-main-video');
  if (!video || !video.readyState || !video.videoWidth || activeShortPath(wrapper) !== key ||
      wrapper.matches('.ad-showing, .ad-interrupting') ||
      card.closest('[hidden], [inert], [aria-hidden="true"]') ||
      !card.checkVisibility({ opacityProperty: true, visibilityProperty: !document.fullscreenElement })) return null;

  const bounds = wrapper.getBoundingClientRect();
  if (bounds.width < 100 || bounds.height < 100 ||
      bounds.right <= 0 || bounds.left >= innerWidth ||
      bounds.bottom <= 0 || bounds.top >= innerHeight) return null;
  return { kind: 'short', key, viewer, wrapper, card, video, source: video.currentSrc, bounds };
}

function actionBarButton(card, action) {
  const bar = card.querySelector('reel-action-bar-view-model');
  for (const item of bar?.querySelectorAll(':scope > button-view-model button') ?? []) {
    const label = item.getAttribute('aria-label');
    const path = item.querySelector('svg path')?.getAttribute('d');
    if (actionLabels[action].test(label) || path?.startsWith(actionIcons[action])) return item;
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
    case 'comments':
      return card.querySelector('#comments-button button') ?? actionBarButton(card, action);
    case 'share':
      return card.querySelector('#share-button button') ?? actionBarButton(card, action);
    case 'captions':
      return card.querySelector('#closed-captioning-button-container button, ytm-closed-captioning-button button');
    case 'subscribe':
      return card.querySelector('yt-subscribe-button-view-model button, #subscribe-button button');
  }
}

function visibleShortControl(reel, action) {
  const button = shortControl(reel, action);
  return button?.getClientRects().length && !button.closest('[hidden], [inert], [aria-hidden="true"]')
    ? button
    : undefined;
}

function shortMetadata(reel) {
  const overlay = reel.card.querySelector('yt-reel-player-overlay-view-model') ?? reel.card;
  const creator = overlay.querySelector('a[href^="/@"], a[href^="/channel/"]');
  const owner = creator?.textContent.trim() || creator?.getAttribute('aria-label') || '';
  const profile = creator?.href.startsWith(`${shortsOrigin}/`) ? creator.href : undefined;
  const title = overlay.querySelector('yt-short-description-view-model, ytd-reel-player-header-renderer #title');
  const subscribe = visibleShortControl(reel, 'subscribe');
  const followControl = isEnabled(subscribe) ? subscribe : undefined;
  const follow = followControl?.textContent.trim() || followControl?.getAttribute('aria-label') || '';
  return { owner, profile, follow, followControl, caption: { text: title?.textContent.trim() ?? '', links: [] } };
}

export const youtubePlayer = {
  control: visibleShortControl,
  liked: (button) => button?.getAttribute('aria-pressed') === 'true',
  isCurrent(reel) {
    return reel.wrapper.closest('ytd-reel-video-renderer') === reel.card &&
      !reel.wrapper.matches('.ad-showing, .ad-interrupting') && activeShortPath(reel.wrapper) === reel.key;
  },
  canLikeInFullscreen: () => Boolean(document.querySelector('ytd-masthead #avatar-btn')),
  metadata: shortMetadata,
  mute(reel) {
    const button = reel.card.querySelector(
      '#mute-button-shape button, #mute-button button, .ytp-mute-button',
    );
    return isEnabled(button) ? { button, muted: reel.video.muted } : null;
  },
};
