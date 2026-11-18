import { webLink } from './caption.js';

const controls = '[role="button"], button';
const captionExcluded = `${controls}, style, script, template, noscript, svg, [hidden], [aria-hidden="true"]`;
const labels = {
  previous: /^(previous (reel|card|video)|föregående (reel|kort|video))$/i,
  next: /^(next (reel|card|video)|nästa (reel|kort|video))$/i,
  like: /^(?:(?<liked>unlike|remove like|sluta gilla|ta bort gilla)|like|gilla)(?:\b|$)/i,
  comments: /^(comment|comments|kommentera|kommentarer)(?:\b|$)/i,
  share: /^(share|dela)(?:\b|$)/i,
  more: /^(more options|fler alternativ)(?:\b|$)/i,
  owner: /owner.{0,12}(profile|profil)|ägar.{0,5}profil/i,
  follow: /^(follow(?:ing)?|unfollow|följ(?:er)?|sluta följa)(?:\s|$)/i,
  expand: /^(see more|show more|visa mer)$/i,
};

const storyLabels = {
  previous: /^(previous card|föregående kort)$/i,
  next: /^(next card|nästa kort)$/i,
  'previous-story': /^(previous story|föregående händelse)$/i,
  'next-story': /^(next story|nästa händelse)$/i,
  share: /^(?:share(?: story)?|dela(?: händelse)?)$/i,
  play: /^(play(?: (?:story|video))?|resume(?: story)?|spela(?: upp)?(?: händelse)?|återuppta(?: händelse)?)$/i,
  pause: /^(pause(?: (?:story|video))?|pausa(?: händelse)?)$/i,
};

function name(element) {
  return element.getAttribute('aria-label') || element.textContent.trim();
}

export function playbackRoute(url) {
  if (/^\/reels?(?:\/\d+)?\/?$/.test(url.pathname)) return 'reel';
  if (/^\/stories\/\d+(?:\/[^/]+)?\/?$/.test(url.pathname)) return 'story';
  return null;
}

export function findStoryGate() {
  const card = Array.from(document.querySelectorAll(controls)).find(
    (button) =>
      /^(click to (?:see|view) (?:the )?story|klicka för att se (?:en )?händelse)$/i.test(name(button)) &&
      isEnabled(button) &&
      button.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
  );
  if (!card) return null;
  return {
    kind: 'story',
    card,
    key: location.pathname.replace(/\/$/, ''),
  };
}

export function findPlayback(kind) {
  let best;
  let overlap = 0;
  const candidates = kind === 'story' ? 'video, [data-id] img' : 'video';
  for (const media of document.querySelectorAll(candidates)) {
    const photo = media.localName === 'img';
    if (photo && !media.naturalWidth) continue;
    const slide = kind === 'story' ? media.closest('[data-id]') : undefined;
    const wrapper = photo
      ? slide
      : (media.closest('[aria-label="Video player"], [data-video-player]') ?? media.parentElement);
    if (
      kind === 'story' &&
      (wrapper.closest('[aria-hidden="true"],[inert]') ||
        !wrapper.checkVisibility({
          opacityProperty: true,
          visibilityProperty: !document.fullscreenElement,
        }))
    ) continue;
    // Fullscreen styling changes the media bounds. Its wrapper stays in the viewer.
    const bounds = wrapper.getBoundingClientRect();
    const visibleWidth = Math.min(innerWidth, bounds.right) - Math.max(bounds.left, 0);
    const visibleHeight = Math.min(innerHeight, bounds.bottom) - Math.max(bounds.top, 0);
    if (visibleWidth < 100 || visibleHeight < 100) continue;
    const score = visibleWidth * visibleHeight;
    if ((best?.video && photo) || (score <= overlap && Boolean(best?.photo) === photo)) continue;
    const card = kind === 'story' ? (storyCard(slide ?? wrapper) ?? slide) : undefined;
    if (kind === 'story' && !card) continue;
    best = { [photo ? 'photo' : 'video']: media, wrapper, card, slide };
    overlap = score;
  }
  if (!best) return null;
  const key = location.pathname.replace(/\/$/, '');
  const media = best.video ?? best.photo;
  const source = media.currentSrc || media.getAttribute('src');
  if (kind === 'story') {
    const storyLink = best.photo ? storyVideoLink(best.slide) : undefined;
    const progress = findStoryProgress(best.slide ?? best.wrapper);
    const storyList = storyListNavigation(key, document);
    const storyActions = findStoryActions(best.card);
    return { ...best, kind, key, source, storyLink, storyList, storyActions, videoLink: storyLink?.href, progress };
  }
  const main = best.wrapper.closest('[role="main"],main');
  let card = best.wrapper;
  while (card.parentElement && card.parentElement !== main) {
    if (findButton(card, 'comments')) break;
    if (card.parentElement.querySelectorAll('video').length > 1) break;
    card = card.parentElement;
  }
  return { ...best, kind, card, key, source };
}

function findButton(scope, action, buttonLabels = labels) {
  return Array.from(scope.querySelectorAll(controls)).find(
    (element) => buttonLabels[action].test(name(element)) && element.getClientRects().length,
  );
}

function storyControl(scope, action) {
  return Object.hasOwn(storyLabels, action) ? findButton(scope, action, storyLabels) : undefined;
}

function findStoryActions(card) {
  let share;
  let reactions = [];
  for (let scope = card; scope && scope !== document.documentElement; scope = scope.parentElement) {
    share ??= storyControl(scope, 'share');
    if (!reactions.length) {
      const dialog = Array.from(scope.querySelectorAll('[role="dialog"][aria-label]')).find((element) =>
        /^(reactions|reaktioner)$/i.test(name(element)) && element.getClientRects().length &&
        !element.closest('[aria-hidden="true"],[inert]'),
      );
      if (dialog) {
        reactions = Array.from(dialog.querySelectorAll(controls)).filter((button) =>
          button.hasAttribute('aria-label') && !/^(close|stäng)\b/i.test(name(button)) &&
          button.getClientRects().length,
        );
      }
    }
    if (share && reactions.length) break;
  }
  return { share, reactions };
}

export function storyListNavigation(path, root) {
  const bucket = path.split('/')[2];
  if (!/^\d+$/.test(bucket)) return;
  const current = root.getElementById(bucket);
  if (!current?.matches(controls) || !current.parentElement) return;
  const rows = Array.from(current.parentElement.children).filter((row) =>
    /^\d+$/.test(row.id) && row.matches(controls) && row.getClientRects().length,
  );
  // The list can update its selected row before Facebook updates the address.
  const selected = rows.filter((row) => getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)');
  const active = selected.length === 1 ? selected[0] : current;
  const index = rows.indexOf(active);
  if (index < 0) return;
  return { bucket: active.id, 'previous-story': rows[index - 1], 'next-story': rows[index + 1] };
}

function storyCard(wrapper) {
  let playback;
  let navigation;
  for (let element = wrapper; element && element !== document.body; element = element.parentElement) {
    if (!playback && (storyControl(element, 'play') || storyControl(element, 'pause'))) {
      playback = element;
    }
    if (!navigation && ['previous', 'next', 'previous-story', 'next-story'].some((action) => storyControl(element, action))) {
      navigation = element;
    }
    if (playback && navigation) return element;
    if (element.querySelectorAll('video').length > 1) break;
  }
  return playback ?? navigation;
}

function storyVideoLink(slide) {
  for (const link of slide.querySelectorAll('a[href*="/reel"]')) {
    const href = webLink(link.href);
    if (!href) continue;
    const url = new URL(href);
    if (url.origin === location.origin && /^\/reels?\/\d+\/?$/.test(url.pathname)) return link;
  }
}

export function storyPhotoRegion({ photo, slide, storyLink }) {
  if (!storyLink || storyLink.contains(photo)) return { source: photo.currentSrc };

  // The link can be a zero-sized inline element with an absolutely positioned hit area.
  const card = slide.getBoundingClientRect();
  for (const target of [storyLink, ...storyLink.children, storyLink.parentElement]) {
    const rect = target.getBoundingClientRect();
    if (rect.width < card.width * 0.25 || rect.height < card.height * 0.25) continue;
    if (rect.width >= card.width || rect.height >= card.height) continue;
    if (rect.left < card.left || rect.top < card.top || rect.right > card.right || rect.bottom > card.bottom) continue;

    const inner = storyLink.querySelector('img');
    if (inner?.currentSrc) {
      const image = inner.getBoundingClientRect();
      if (image.width >= rect.width * 0.9 && image.height >= rect.height * 0.9) {
        return { source: inner.currentSrc };
      }
    }
    return {
      source: photo.currentSrc,
      crop: [
        (rect.left - card.left) / card.width,
        (rect.top - card.top) / card.height,
        (rect.right - card.left) / card.width,
        (rect.bottom - card.top) / card.height,
      ],
    };
  }
  return null;
}

function findStoryProgress(card) {
  const bounds = card.getBoundingClientRect();
  for (let scope = card; scope && scope !== document.body; scope = scope.parentElement) {
    if (scope.getBoundingClientRect().width > bounds.width * 1.3) break;
    const pinned = scope.querySelector('[data-voltura-story-progress]');
    if (pinned?.getClientRects().length) return pinned;
    for (const row of scope.querySelectorAll('div')) {
      if (!row.children.length) continue;
      const rect = row.getBoundingClientRect();
      if (
        rect.height <= 0 ||
        rect.height > 8 ||
        rect.width < bounds.width * 0.65 ||
        rect.width > bounds.width ||
        rect.top < bounds.top ||
        rect.top > bounds.top + 32
      ) continue;
      if (Array.from(row.children).every((segment) => {
        const size = segment.getBoundingClientRect();
        return segment.firstElementChild && size.width > 0 && size.height === rect.height;
      })) return row;
    }
  }
}

function findFollowControl(scope) {
  const selector = `${controls}, a[href="#"], a[aria-pressed], [role="link"]:not([href])`;
  const candidates = scope.matches(selector) ? [scope] : scope.querySelectorAll(selector);
  return Array.from(candidates).find((element) => {
    const label = name(element);
    const text = element.textContent.trim();
    const action = /^(follow|following|unfollow|följ|följer|sluta följa)$/i;
    const matches = element.matches(controls)
      ? labels.follow.test(label)
      : action.test(text) || action.test(label);
    return matches && element.getClientRects().length;
  });
}

export function reelControl(reel, action) {
  if (reel.kind === 'story') {
    if (action === 'share' && reel.storyActions?.share) return reel.storyActions.share;
    const native = storyControl(reel.card, action);
    return isEnabled(native) ? native : reel.storyList?.[action] ?? native;
  }
  if (action === 'previous-story' || action === 'next-story') return;
  const navigation = action === 'previous' || action === 'next';
  return findButton(
    navigation ? (reel.card.closest('[role="main"],main') ?? document) : reel.card,
    action,
  );
}

export function isEnabled(button) {
  return Boolean(button && !button.matches(':disabled,[aria-disabled="true"]'));
}

export function reelLiked(button) {
  return Boolean(
    button &&
      (button.getAttribute('aria-pressed') === 'true' || labels.like.exec(name(button))?.groups.liked),
  );
}

export function reelMuteControl(reel) {
  if (reel.embedded) return null;
  const mute =
    /^(mute(?: (?:audio|video|sound|story))?|turn (?:off (?:the )?sound|sound off)|stäng av (?:ljud(?:et)?|händelsens ljud)|inaktivera(?: ljud(?:et)?)?)$/i;
  const unmute =
    /^(unmute(?: (?:audio|video|sound|story))?|turn (?:on (?:the )?sound|sound on)|(?:slå|sätt) på (?:ljud(?:et)?|händelsens ljud)|aktivera(?: ljud(?:et)?)?)$/i;
  const scope = reel.kind === 'story' ? reel.card : reel.wrapper;
  for (const button of scope.querySelectorAll(controls)) {
    if (!isEnabled(button) || !button.getClientRects().length) continue;
    const names = [name(button), button.getAttribute('title'), button.querySelector('svg title')?.textContent];
    if (names.some((label) => mute.test(label?.trim()))) return { button, muted: false };
    if (names.some((label) => unmute.test(label?.trim()))) return { button, muted: true };
  }
  return null;
}

export function reelVolumeControl(reel) {
  if (reel.embedded) return undefined;
  return Array.from(reel.wrapper.querySelectorAll('[role="slider"],input[type="range"]')).find(
    (element) => /^(change volume|adjust volume|volume|ändra volymen|volym)$/i.test(name(element)),
  );
}

export function setReelVolume(reel, volume) {
  const slider = reelVolumeControl(reel);
  if (!slider || slider.matches(':disabled,[aria-disabled="true"]')) return;
  if (slider instanceof HTMLInputElement) {
    slider.value =
      Number(slider.min || 0) + volume * (Number(slider.max || 100) - Number(slider.min || 0));
    for (const type of ['input', 'change']) slider.dispatchEvent(new Event(type, { bubbles: true }));
    return;
  }
  const bounds = slider.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const options = {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
    clientX: bounds.left + bounds.width * volume,
    clientY: bounds.top + bounds.height / 2,
  };
  slider.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
  slider.dispatchEvent(new MouseEvent('mouseup', options));
}

function readCaption(caption) {
  let text = '';
  const links = [];
  function lineBreak() {
    if (text && !text.endsWith('\n')) text += '\n';
  }
  function read(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.data;
      return;
    }
    if (!(node instanceof Element) || node.matches(captionExcluded)) return;
    const { display } = getComputedStyle(node);
    if (display === 'none') return;
    if (node.localName === 'br') {
      text += '\n';
      return;
    }
    const block = /^(block|flow-root|flex|grid|list-item|table)$/.test(display);
    if (block) lineBreak();
    const start = text.length;
    for (const child of node.childNodes) read(child);
    if (node.matches('a[href]') && text.length > start) {
      const href = webLink(node.href);
      if (href) links.push({ start, end: text.length, href });
    }
    if (block) lineBreak();
  }
  read(caption);
  const trimmed = text.trim();
  const left = text.length - text.trimStart().length;
  for (const link of links) {
    link.start = Math.max(0, link.start - left);
    link.end = Math.min(trimmed.length, link.end - left);
  }
  return { text: trimmed, links: links.filter((link) => link.start < link.end) };
}

export function reelMetadata(reel) {
  const links = Array.from(reel.card.querySelectorAll('a[aria-label]')).filter((element) =>
    labels.owner.test(name(element)),
  );
  const owner = links.find((element) => element.textContent.trim());
  const heading = owner?.closest('h1,h2,h3,h4,[role="heading"]');
  const photo = links.map((link) => link.querySelector('img, svg image')).find(Boolean);
  let follow;
  let caption = { text: '', links: [] };
  let more;
  for (let element = heading; element && element !== reel.card; element = element.parentElement) {
    follow ??= findFollowControl(element);
    const next = element.nextElementSibling;
    if (!next || next.matches(captionExcluded)) continue;
    const siblingFollow = findFollowControl(next);
    if (siblingFollow && next.textContent.trim() === siblingFollow.textContent.trim()) continue;
    caption = readCaption(next);
    if (!caption.text) continue;
    more = findButton(next, 'expand');
    break;
  }
  const profile = owner?.href ?? links[0]?.href;
  return {
    owner: owner?.textContent.trim() ?? '',
    profile: profile?.startsWith(`${location.origin}/`) ? profile : undefined,
    photo:
      photo &&
      webLink(
        photo.currentSrc ||
          photo.getAttribute('src') ||
          photo.getAttribute('href') ||
          photo.getAttribute('xlink:href'),
        document.baseURI,
      ),
    follow: follow?.textContent.trim() || (follow && name(follow)),
    followControl: follow,
    caption,
    more,
  };
}

export function nativeAction(reel, action) {
  const button = reelControl(reel, action);
  if (!isEnabled(button)) return false;
  button.click();
  return true;
}
