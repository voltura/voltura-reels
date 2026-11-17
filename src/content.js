import { ReelPlayer } from './player.js';
import { findPlayback, playbackRoute } from './facebook.js';

let player;
let pending;

function refresh() {
  pending = undefined;
  const kind = playbackRoute(location);
  if (!kind) {
    player?.destroy();
    player = undefined;
    return;
  }
  const reel = findPlayback(kind);
  if (!reel) {
    player?.waitForPlayback();
    return;
  }
  player ??= new ReelPlayer(schedule);
  player.update(reel);
}

function schedule() {
  if (pending === undefined) pending = setTimeout(refresh, 70);
}

const observer = new MutationObserver((records) => {
  if (
    (player || playbackRoute(location)) &&
    records.some((record) => {
      if (record.type === 'characterData') {
        const control = record.target.parentElement?.closest(
          'button, [role="button"], a[href], [role="link"]',
        );
        return player?.active && control && player.reel.card.contains(control);
      }
      return record.target.localName !== 'voltura-reel-player';
    })
  )
    schedule();
});
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['src', 'loop', 'disabled', 'aria-disabled', 'aria-pressed', 'aria-label'],
});
navigation.addEventListener('currententrychange', schedule);
window.addEventListener('resize', schedule);
document.addEventListener('scroll', schedule, { capture: true, passive: true });
document.addEventListener('loadedmetadata', schedule, true);
schedule();
