import { ReelPlayer } from './player.js';
import { findReel, reelRoute } from './facebook.js';

let player;
let pending;

function refresh() {
  pending = undefined;
  if (!reelRoute(location)) {
    player?.destroy();
    player = undefined;
    return;
  }
  const reel = findReel();
  if (!reel) {
    player?.waitForReel();
    return;
  }
  player ??= new ReelPlayer(schedule);
  player.update(reel);
}

function schedule() {
  if (pending === undefined) pending = setTimeout(refresh, 70);
}

const observer = new MutationObserver(records => {
  if ((player || reelRoute(location)) && records.some(record => record.target.localName !== 'voltura-reel-player')) schedule();
});
observer.observe(document.documentElement, {
  subtree: true, childList: true, attributes: true,
  attributeFilter: ['src', 'loop', 'aria-disabled', 'aria-pressed', 'aria-label'],
});
navigation.addEventListener('currententrychange', schedule);
window.addEventListener('resize', schedule);
document.addEventListener('scroll', schedule, { capture: true, passive: true });
document.addEventListener('loadedmetadata', schedule, true);
schedule();
