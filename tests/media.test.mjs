import assert from 'node:assert/strict';
import test from 'node:test';
import { panBounds, seekTarget, timeText } from '../src/media.js';
import { reelRoute } from '../src/facebook.js';
import { languages, resolveLanguage, translator } from '../extension/languages.js';

test('relative seeking crosses gaps in the requested direction', () => {
  const ranges = {
    length: 2,
    start: index => [2, 9][index],
    end: index => [5, 20][index],
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

test('a reel path is required before attaching the player', () => {
  assert.ok(reelRoute(new URL('https://www.facebook.com/reel/?s=tab')));
  assert.ok(reelRoute(new URL('https://www.facebook.com/reel/1691796978562429/')));
  assert.ok(!reelRoute(new URL('https://www.facebook.com/watch/?v=100')));
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
