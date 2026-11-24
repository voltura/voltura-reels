import assert from 'node:assert/strict';
import test from 'node:test';
import { shortsEnabled, shortsPath, syncShortsAccess } from '../extension/shorts-access.js';
import { frameDownload, storyPhotoDownload } from '../extension/story-photo.js';
import { findShortsPlayback, youtubePlayer } from '../src/youtube.js';

const short = 'https://www.youtube.com/shorts/-dEzGR3Vlck';

test('Shorts routing recognizes only individual clips on desktop YouTube', () => {
  const route = (url) => shortsPath(new URL(url, short));
  assert.equal(route(short + '/?feature=share'), '/shorts/-dEzGR3Vlck');
  for (const url of [
    '/shorts/', '/shorts/123', '/shorts/-dEzGR3Vlck/embed', '/watch?v=-dEzGR3Vlck',
    'http://www.youtube.com/shorts/-dEzGR3Vlck', 'https://m.youtube.com/shorts/-dEzGR3Vlck',
    'https://www.youtube.com.example.org/shorts/-dEzGR3Vlck',
  ]) assert.equal(route(url), null, url);
});

test('optional site access registers once, covers open tabs, and cleans up after revocation', async () => {
  let granted = false;
  let registered;
  let enabled;
  const injected = [];
  const { origin } = new URL(short);
  const api = {
    permissions: {
      async contains({ origins }) {
        assert.deepEqual(origins, [origin + '/*']);
        return granted;
      },
    },
    scripting: {
      getRegisteredContentScripts: async () => registered ? [registered] : [],
      async registerContentScripts([script]) {
        assert.equal(registered, undefined);
        registered = script;
      },
      async unregisterContentScripts({ ids }) {
        assert.deepEqual(ids, [registered.id]);
        registered = undefined;
      },
      async executeScript(details) {
        injected.push(details);
        if (details.target.tabId === 7) throw new Error('Tab closed before injection');
      },
    },
    storage: {
      local: {
        get: async () => ({ [shortsEnabled]: enabled }),
        async set(values) { enabled = values[shortsEnabled]; },
        async remove(key) {
          assert.equal(key, shortsEnabled);
          enabled = undefined;
        },
      },
    },
    tabs: {
      async query({ url }) {
        assert.deepEqual(url, [origin + '/*']);
        return [{ id: 5 }, { id: 7 }];
      },
    },
  };
  assert.equal(await syncShortsAccess(api), false);
  assert.equal(registered, undefined);
  granted = true;
  assert.equal(await syncShortsAccess(api), true);
  assert.deepEqual(registered.matches, [origin + '/*']);
  assert.deepEqual(registered.js, ['shorts.js']);
  assert.deepEqual(injected.map(({ target }) => target.tabId), [5, 7]);
  assert.equal(enabled, true);
  assert.equal(await syncShortsAccess(api), true);
  assert.equal(injected.length, 2);
  granted = false;
  assert.equal(await syncShortsAccess(api), false);
  assert.equal(registered, undefined);
  assert.equal(enabled, undefined);
});

test('playback binds only to ready media in the active Shorts renderer', () => {
  const instance = { querySelector: () => { throw new Error('Do not query Watch media'); } };
  const media = { readyState: 2, videoWidth: 360, currentSrc: 'blob:short' };
  const bounds = { width: 360, height: 620, top: 50, left: 125, right: 485, bottom: 670 };
  const card = { checkVisibility: () => true, closest: () => null };
  const title = { href: short };
  const wrapper = {
    closest: () => card,
    matches: () => false,
    querySelector(selector) {
      if (selector === 'video.html5-main-video') return media;
      if (selector === 'a.ytp-title-link[href]') return title;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    getBoundingClientRect: () => bounds,
  };
  const globals = { document: instance, innerWidth: 800, innerHeight: 720 };
  Object.assign(globalThis, globals);
  try {
    const viewer = {
      querySelector: (selector) => selector === '#shorts-player' ? wrapper : instance,
    };
    assert.equal(findShortsPlayback(viewer, '/shorts/-dEzGR3Vlck').video, media);
    assert.equal(findShortsPlayback(viewer, '/shorts/fixture0002'), null);
    title.href = 'https://www.youtube.com/shorts/fixture0002';
    assert.equal(findShortsPlayback(viewer, '/shorts/fixture0002').video, media);
    wrapper.matches = () => true;
    assert.equal(findShortsPlayback(viewer, '/shorts/fixture0002'), null);
    assert.equal(findShortsPlayback(null, '/shorts/-dEzGR3Vlck'), null);
  } finally {
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
});

test('Shorts like state follows the native toggle', () => {
  const button = { getAttribute: () => 'true' };
  assert.equal(youtubePlayer.liked(button), true);
  button.getAttribute = () => 'false';
  assert.equal(youtubePlayer.liked(button), false);
});

test('Shorts exposes Subscribe only if the native control is available', () => {
  let hidden = true;
  let disabled = false;
  const button = {
    textContent: 'Subscribed',
    getClientRects: () => [1],
    closest: () => hidden ? {} : null,
    matches: () => disabled,
  };
  const card = { querySelector: (selector) => selector.startsWith('yt-subscribe-') ? button : null };
  const reel = { card };
  assert.equal(youtubePlayer.control(reel, 'subscribe'), undefined);
  assert.equal(youtubePlayer.metadata(reel).follow, '');
  hidden = false;
  assert.equal(youtubePlayer.control(reel, 'subscribe'), button);
  assert.equal(youtubePlayer.metadata(reel).follow, 'Subscribed');
  disabled = true;
  assert.equal(youtubePlayer.metadata(reel).follow, '');
});

test('Shorts frame downloads use the same-origin blob and reject other YouTube views', () => {
  const sender = { url: short, frameId: 0 };
  const message = {
    type: 'save-video-frame',
    source: 'blob:https://www.youtube.com/634804af-1030-4f89-a4c9-4699315926ce',
    time: '0m03.0',
  };
  assert.equal(frameDownload(message, sender).filename, 'short-0m03.0.png');
  assert.equal(frameDownload(message, { ...sender, url: 'https://www.youtube.com/watch?v=-dEzGR3Vlck' }), null);
  assert.equal(frameDownload(message, { ...sender, frameId: 1 }), null);
  assert.equal(frameDownload({ ...message, source: message.source.replace('youtube', 'facebook') }, sender), null);
  assert.equal(frameDownload({ ...message, type: 'save-cropped-story-photo' }, sender), null);
  assert.equal(storyPhotoDownload('https://www.youtube.com/image.jpg', sender), null);
});
