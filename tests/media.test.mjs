import assert from 'node:assert/strict';
import test from 'node:test';
import { panBounds, seekTarget, timeText } from '../src/media.js';
import { nativeAction, playbackRoute, reelControl, reelLiked, storyPhotoRegion } from '../src/facebook.js';
import { languages, resolveLanguage, translator } from '../extension/languages.js';
import { frameDownload, storyPhotoDownload } from '../extension/story-photo.js';
import { refineStoryCrop } from '../extension/story-crop.js';

test('relative seeking crosses gaps in the requested direction', () => {
  const ranges = {
    length: 2,
    start: (index) => [2, 9][index],
    end: (index) => [5, 20][index],
  };
  assert.equal(seekTarget(ranges, 6, 1), 9);
  assert.equal(seekTarget(ranges, 6, -1), 5);
  assert.equal(seekTarget(ranges, 6, 0), 5);
  assert.equal(seekTarget(ranges, 10.1, 1), 10.1);
  assert.equal(seekTarget(ranges, 21, 1), 20);
});

test('pan bounds account for letterboxing', () => {
  assert.deepEqual(panBounds(1280, 720, 720, 1280, 2), [0, 360]);
  assert.deepEqual(panBounds(1280, 720, 1920, 1080, 2), [640, 360]);
  assert.equal(timeText(61.19), '1:01.1');
});

test('the player attaches only to Reel and Story playback routes', () => {
  const route = (path) => playbackRoute(new URL(path, 'https://www.facebook.com'));
  assert.equal(route('/reel/?s=tab'), 'reel');
  assert.equal(route('/reel/1691796978562429/'), 'reel');
  assert.equal(route('/stories/123/UzpfSVNDOjEwNzEzMTAxNTU5OTgyNjA=/?source=story_tray'), 'story');
  assert.equal(route('/stories/123'), 'story');
  assert.equal(route('/stories/'), null);
  assert.equal(route('/stories/create/'), null);
  assert.equal(route('/watch/?v=100'), null);
});

test('Story navigation and pause use the Story viewer controls', () => {
  const clicked = [];
  const buttons = ['Nästa reel', 'Nästa händelse', 'Nästa kort', 'Pausa', 'Gilla'].map((label) => ({
    getAttribute: () => label,
    getClientRects: () => [{}],
    matches: () => false,
    click: () => clicked.push(label),
  }));
  const story = { kind: 'story', card: { querySelectorAll: () => buttons } };

  assert.equal(nativeAction(story, 'next'), true);
  assert.equal(nativeAction(story, 'next-story'), true);
  assert.equal(nativeAction({ ...story, storyList: { 'previous-story': buttons[1] } }, 'previous-story'), true);
  assert.equal(nativeAction(story, 'pause'), true);
  assert.equal(nativeAction(story, 'like'), false);
  assert.deepEqual(clicked, ['Nästa kort', 'Nästa händelse', 'Nästa händelse', 'Pausa']);
});

test('Story photo downloads are limited to the top-level Facebook viewer and Facebook image hosts', () => {
  const sender = { url: 'https://www.facebook.com/stories/123/story-id/', frameId: 0 };
  const source = 'https://scontent.example.fbcdn.net/photo.JPG?signature=example';
  assert.deepEqual(storyPhotoDownload(source, sender), {
    url: source,
    filename: 'facebook-story.jpg',
    conflictAction: 'uniquify',
  });
  assert.equal(storyPhotoDownload('https://fbcdn.net.example.com/photo.jpg', sender), null);
  assert.equal(storyPhotoDownload('https://evil.example/photo.jpg', sender), null);
  assert.equal(storyPhotoDownload(source, { ...sender, frameId: 1 }), null);
  assert.equal(storyPhotoDownload(source, { ...sender, url: 'https://www.facebook.com/reel/123/' }), null);
});

test('a shared Reel uses the visible link area inside the Story image', () => {
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const source = 'https://scontent.example.fbcdn.net/story.jpg';
  const photo = { currentSrc: source };
  const slide = { getBoundingClientRect: () => box(800, 60, 400, 700) };
  const hitArea = { getBoundingClientRect: () => box(860, 200, 280, 490) };
  const storyLink = {
    contains: () => false,
    children: [hitArea],
    parentElement: hitArea,
    querySelector: () => null,
    getBoundingClientRect: () => box(860, 200, 0, 0),
  };
  assert.deepEqual(storyPhotoRegion({ photo, slide, storyLink }), { source, crop: [0.15, 0.2, 0.85, 0.9] });
  assert.deepEqual(storyPhotoRegion({ photo, slide }), { source });
  const innerImage = { currentSrc: 'https://scontent.example.fbcdn.net/thumbnail.jpg', ...hitArea };
  assert.deepEqual(storyPhotoRegion({ photo, slide, storyLink: { ...storyLink, querySelector: () => innerImage } }), {
    source: innerImage.currentSrc,
  });
});

test('a linked Story crop finds different source borders and preserves square corners', () => {
  for (const { width, height, left, top, right, bottom, radius } of [
    { width: 320, height: 520, left: 6, top: 10, right: 4, bottom: 3, radius: 17 },
    { width: 615, height: 410, left: 12, top: 3, right: 7, bottom: 9, radius: 32 },
    { width: 390, height: 660, left: 4, top: 9, right: 10, bottom: 4, radius: 0 },
  ]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBounds = x >= left && y >= top && x < width - right && y < height - bottom;
        const dx = Math.max(left + radius - x - 0.5, x + 0.5 - (width - right - radius), 0);
        const dy = Math.max(top + radius - y - 0.5, y + 0.5 - (height - bottom - radius), 0);
        const color = inBounds && Math.hypot(dx, dy) <= radius ? 195 : 75;
        data.set([color, color, color, 255], (y * width + x) * 4);
      }
    }
    const crop = refineStoryCrop({ data, width, height });
    assert.deepEqual(
      [crop.x, crop.y, crop.width, crop.height],
      [left + 1, top + 1, width - left - right - 2, height - top - bottom - 2],
    );
    if (radius) {
      assert.ok(crop.mask.radii.every((measured) => Math.abs(measured - radius) <= 5));
    } else {
      assert.equal(crop.mask, undefined);
    }
  }
});

test('frame downloads accept only local Facebook blobs and generate the filename', () => {
  const sender = { url: 'https://www.facebook.com/reel/123/', frameId: 0 };
  const source = 'blob:https://www.facebook.com/634804af-1030-4f89-a4c9-4699315926ce';
  assert.deepEqual(frameDownload({ source, time: '1m23.4' }, sender), {
    url: source,
    filename: 'reel-1m23.4.png',
    conflictAction: 'uniquify',
  });
  assert.equal(frameDownload({ source, time: '../unsafe' }, sender), null);
  assert.equal(frameDownload({ source, time: '1m23.4' }, { ...sender, frameId: 1 }), null);
  assert.equal(frameDownload({ source: source.replace('facebook.com', 'elsewhere.com'), time: '1m23.4' }, sender), null);
});

test('the native Swedish Like button remains available as its label changes', () => {
  const reactionCount = '70,3\u00a0tn reaktioner';
  let label = `Ta bort Gilla, ${reactionCount}`;
  const like = {
    getAttribute: (attribute) => (attribute === 'aria-label' ? label : null),
    getClientRects: () => [{}],
    matches: () => false,
    click: () => {
      label = `${reelLiked(like) ? 'Gilla' : 'Ta bort Gilla'}, ${reactionCount}`;
    },
  };
  const reactionMenu = { ...like, getAttribute: () => 'Ändra reaktionen Gilla' };
  const reel = { card: { querySelectorAll: () => [reactionMenu, like] } };

  assert.equal(reelControl(reel, 'like'), like);
  assert.equal(reelLiked(like), true);
  assert.equal(nativeAction(reel, 'like'), true);
  assert.equal(reelLiked(like), false);
  assert.equal(nativeAction(reel, 'like'), true);
  assert.equal(reelLiked(like), true);
});

test('language resolution retains regional and script distinctions', () => {
  assert.equal(resolveLanguage('auto', ['zh-Hans-CN', 'sv-SE']), 'sv');
  assert.equal(resolveLanguage('auto', ['pt-PT']), 'pt-PT');
  assert.equal(resolveLanguage('auto', ['no-NO']), 'nb');
  assert.equal(resolveLanguage('ja', ['en-US']), 'ja');
  for (const { code } of languages) {
    if (code !== 'en') assert.notEqual(translator(code)('Save image'), 'Save image');
  }
});
