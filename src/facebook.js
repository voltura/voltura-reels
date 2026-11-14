const controls = '[role="button"], button';
const labels = {
  previous: /^(previous (reel|card|video)|föregående (reel|kort|video))$/i,
  next: /^(next (reel|card|video)|nästa (reel|kort|video))$/i,
  like: /^(like|unlike|gilla|sluta gilla)(?:\b|$)/i,
  comments: /^(comment|comments|kommentera|kommentarer)(?:\b|$)/i,
  share: /^(share|dela)(?:\b|$)/i,
  more: /^(more options|fler alternativ)(?:\b|$)/i,
  owner: /owner.{0,12}(profile|profil)|ägar.{0,5}profil/i,
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

export function reelMetadata(reel) {
  const owner = Array.from(reel.card.querySelectorAll('a[aria-label]'))
    .find(element => labels.owner.test(name(element)) && element.textContent.trim());
  const heading = owner?.closest('h1,h2,h3,h4,[role="heading"]');
  let caption;
  for (let element = heading; element && element !== reel.card; element = element.parentElement) {
    const next = element.nextElementSibling;
    if (next?.textContent.trim()) {
      caption = next;
      break;
    }
  }
  return {
    owner: owner?.textContent.trim() ?? '',
    profile: owner?.href,
    caption: caption?.innerText?.trim().replace(/(?:See more|Visa mer)\s*$/i, '').trim() ?? '',
  };
}

export function nativeAction(reel, action) {
  const button = reelControl(reel, action);
  if (!isEnabled(button)) return false;
  button.click();
  return true;
}
