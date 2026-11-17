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
  previous: /^(previous story|föregående (händelse|berättelse))$/i,
  next: /^(next story|nästa (händelse|berättelse))$/i,
  play: /^(play(?: (?:story|video))?|resume(?: story)?|spela(?: upp)?|återuppta)$/i,
  pause: /^(pause(?: (?:story|video))?|pausa)$/i,
};

function name(element) {
  return element.getAttribute('aria-label') || element.textContent.trim();
}

export function playbackRoute(url) {
  if (/^\/reels?(?:\/\d+)?\/?$/.test(url.pathname)) return 'reel';
  if (/^\/stories\/\d+(?:\/[^/]+)?\/?$/.test(url.pathname)) return 'story';
  return null;
}

export function reelHeaderBottom() {
  // Facebook's banner can have zero height while its account navigation is fixed.
  const header = 'header, [role="banner"]';
  const navigation = `:is(${header}) :is(nav, [role="navigation"])`;
  let bottom = 0;
  for (const element of document.querySelectorAll(`${header}, ${navigation}`)) {
    const bounds = element.getBoundingClientRect();
    if (bounds.width && bounds.height && bounds.top <= 0) {
      bottom = Math.max(bottom, bounds.bottom);
    }
  }
  return bottom;
}

export function findPlayback(kind) {
  let best;
  let overlap = 0;
  for (const video of document.querySelectorAll('video')) {
    const wrapper =
      video.closest('[aria-label="Video player"], [data-video-player]') ?? video.parentElement;
    if (
      kind === 'story' &&
      (video.closest('[aria-hidden="true"],[inert]') || !wrapper.checkVisibility({ opacityProperty: true }))
    ) continue;
    // Fullscreen styling changes the video bounds. The wrapper stays in the reel feed.
    const bounds = wrapper.getBoundingClientRect();
    const visibleWidth = Math.min(innerWidth, bounds.right) - Math.max(bounds.left, 0);
    const visibleHeight = Math.min(innerHeight, bounds.bottom) - Math.max(bounds.top, 0);
    if (visibleWidth < 100 || visibleHeight < 100) continue;
    const score = visibleWidth * visibleHeight;
    if (score > overlap) {
      best = { video, wrapper, bounds };
      overlap = score;
    }
  }
  if (!best) return null;
  const key = location.pathname.replace(/\/$/, '');
  const source = best.video.getAttribute('src') || best.video.currentSrc;
  if (kind === 'story') {
    const card = storyCard(best.wrapper);
    return card && { ...best, kind, card, key, source };
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

function storyCard(wrapper) {
  let playback;
  for (let element = wrapper; element && element !== document.body; element = element.parentElement) {
    if (findButton(element, 'previous', storyLabels) || findButton(element, 'next', storyLabels)) {
      return element;
    }
    if (!playback && (findButton(element, 'play', storyLabels) || findButton(element, 'pause', storyLabels))) {
      playback = element;
    }
    if (element.querySelectorAll('video').length > 1) break;
  }
  return playback;
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
    return Object.hasOwn(storyLabels, action) ? findButton(reel.card, action, storyLabels) : undefined;
  }
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
  const mute =
    /^(mute(?: (?:audio|video|sound))?|turn (?:off sound|sound off)|stäng av ljudet|inaktivera)$/i;
  const unmute =
    /^(unmute(?: (?:audio|video|sound))?|turn (?:on sound|sound on)|slå på ljudet|aktivera)$/i;
  const scope = reel.kind === 'story' ? reel.card : reel.wrapper;
  for (const button of scope.querySelectorAll(controls)) {
    if (!isEnabled(button) || !button.getClientRects().length) continue;
    const label = name(button);
    if (mute.test(label)) return { button, muted: false };
    if (unmute.test(label)) return { button, muted: true };
  }
  return null;
}

export function reelVolumeControl(reel) {
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
