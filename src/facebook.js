const controls = '[role="button"], button';
const labels = {
  previous: /^(previous (reel|card|video)|föregående (reel|kort|video))$/i,
  next: /^(next (reel|card|video)|nästa (reel|kort|video))$/i,
  like: /^(like|unlike|gilla|sluta gilla)(?:\b|$)/i,
  comments: /^(comment|comments|kommentera|kommentarer)(?:\b|$)/i,
  share: /^(share|dela)(?:\b|$)/i,
  more: /^(more options|fler alternativ)(?:\b|$)/i,
  owner: /owner.{0,12}(profile|profil)|ägar.{0,5}profil/i,
  follow: /^(follow(?:ing)?|unfollow|följ(?:er)?|sluta följa)(?:\s|$)/i,
  expand: /^(see more|show more|visa mer)$/i,
};

function name(element) {
  return element.getAttribute('aria-label') || element.textContent.trim();
}

export function reelRoute(url) {
  return /^\/reels?(?:\/\d+)?\/?$/.test(url.pathname);
}

export function findReel() {
  if (!reelRoute(location)) return null;
  let best;
  let overlap = 0;
  for (const video of document.querySelectorAll('video')) {
    const wrapper = video.closest('[aria-label="Video player"], [data-video-player]') ?? video.parentElement;
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
  const main = best.wrapper.closest('[role="main"],main');
  let card = best.wrapper;
  while (card.parentElement && card.parentElement !== main) {
    if (findButton(card, 'comments')) break;
    if (card.parentElement.querySelectorAll('video').length > 1) break;
    card = card.parentElement;
  }
  return { ...best, card, key: location.pathname.replace(/\/$/, '') };
}

function findButton(scope, action) {
  return Array.from(scope.querySelectorAll(controls))
    .find(element => labels[action].test(name(element)) && element.getClientRects().length);
}

export function reelControl(reel, action) {
  const navigation = action === 'previous' || action === 'next';
  return findButton(navigation ? reel.card.closest('[role="main"],main') ?? document : reel.card, action);
}

export function isEnabled(button) {
  return Boolean(button && !button.matches(':disabled,[aria-disabled="true"]'));
}

export function reelMuteControl(reel) {
  const mute = /^(mute(?: (?:audio|video|sound))?|turn (?:off sound|sound off)|stäng av ljudet|inaktivera)$/i;
  const unmute = /^(unmute(?: (?:audio|video|sound))?|turn (?:on sound|sound on)|slå på ljudet|aktivera)$/i;
  for (const button of reel.wrapper.querySelectorAll(controls)) {
    if (!isEnabled(button) || !button.getClientRects().length) continue;
    const label = name(button);
    if (mute.test(label)) return { button, muted: false };
    if (unmute.test(label)) return { button, muted: true };
  }
  return null;
}

export function reelVolumeControl(reel) {
  return Array.from(reel.wrapper.querySelectorAll('[role="slider"],input[type="range"]'))
    .find(element => /^(change volume|adjust volume|volume|ändra volymen|volym)$/i.test(name(element)));
}

export function setReelVolume(reel, volume) {
  const slider = reelVolumeControl(reel);
  if (!slider || slider.matches(':disabled,[aria-disabled="true"]')) return;
  if (slider instanceof HTMLInputElement) {
    slider.value = Number(slider.min || 0) + volume * (Number(slider.max || 100) - Number(slider.min || 0));
    for (const type of ['input', 'change']) slider.dispatchEvent(new Event(type, { bubbles: true }));
    return;
  }
  const bounds = slider.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const options = {
    bubbles: true, cancelable: true, view: window, button: 0,
    clientX: bounds.left + bounds.width * volume, clientY: bounds.top + bounds.height / 2,
  };
  slider.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
  slider.dispatchEvent(new MouseEvent('mouseup', options));
}

export function reelMetadata(reel) {
  const links = Array.from(reel.card.querySelectorAll('a[aria-label]'))
    .filter(element => labels.owner.test(name(element)));
  const owner = links.find(element => element.textContent.trim());
  const heading = owner?.closest('h1,h2,h3,h4,[role="heading"]');
  const photo = links.map(link => link.querySelector('img, svg image')).find(Boolean);
  let follow;
  let caption;
  for (let element = heading; element && element !== reel.card; element = element.parentElement) {
    follow ??= findButton(element, 'follow');
    const next = element.nextElementSibling;
    if (next?.textContent.trim() && !next.matches(controls) && !findButton(next, 'follow')) {
      caption = next;
      break;
    }
  }
  const more = caption && findButton(caption, 'expand');
  const description = caption?.cloneNode(true);
  for (const button of description?.querySelectorAll(controls) ?? []) button.remove();
  const profile = owner?.href ?? links[0]?.href;
  return {
    owner: owner?.textContent.trim() ?? '',
    profile: profile?.startsWith(`${location.origin}/`) ? profile : undefined,
    photo: photo?.currentSrc || photo?.getAttribute('src') || photo?.getAttribute('href') || photo?.getAttribute('xlink:href'),
    follow: follow?.textContent.trim() || (follow && name(follow)),
    caption: description?.textContent.trim() ?? '',
    more,
  };
}

export function nativeAction(reel, action) {
  const button = reelControl(reel, action);
  if (!isEnabled(button)) return false;
  button.click();
  return true;
}
