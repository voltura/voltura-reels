import assert from 'node:assert/strict';
import test from 'node:test';
import { panBounds, seekTarget, timeText } from '../src/media.js';
import { nativeAction, playbackRoute, reelControl, reelLiked } from '../src/facebook.js';
import { languages, resolveLanguage, translator } from '../extension/languages.js';

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
  const buttons = ['Nästa reel', 'Nästa händelse', 'Pausa', 'Gilla'].map((label) => ({
    getAttribute: () => label,
    getClientRects: () => [{}],
    matches: () => false,
    click: () => clicked.push(label),
  }));
  const story = { kind: 'story', card: { querySelectorAll: () => buttons } };

  assert.equal(nativeAction(story, 'next'), true);
  assert.equal(nativeAction(story, 'pause'), true);
  assert.equal(nativeAction(story, 'like'), false);
  assert.deepEqual(clicked, ['Nästa händelse', 'Pausa']);
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
    if (code !== 'en') assert.notEqual(translator(code)('Save frame as PNG'), 'Save frame as PNG');
  }
});
