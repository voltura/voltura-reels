import { ReelPlayer } from './player.js';
import { findPlayback, findStoryGate, playbackRoute } from './facebook.js';

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
  const gate = kind === 'story' ? findStoryGate() : null;
  const reel = gate ? null : findPlayback(kind);
  if (gate || reel) player ??= new ReelPlayer(schedule);
  if (gate) player.showStoryGate(gate);
  else if (reel) player.update(reel);
  else player?.waitForPlayback();
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
  attributeFilter: ['src', 'srcset', 'loop', 'disabled', 'aria-disabled', 'aria-pressed', 'aria-label'],
});
navigation.addEventListener('currententrychange', schedule);
window.addEventListener('resize', schedule);
document.addEventListener('scroll', schedule, { capture: true, passive: true });
document.addEventListener('loadedmetadata', schedule, true);
document.addEventListener('load', (event) => {
  if (event.target.localName === 'img' && playbackRoute(location) === 'story') schedule();
}, true);
schedule();
