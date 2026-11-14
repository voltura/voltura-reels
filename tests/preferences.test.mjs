import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { defaultTheme, formatPlaybackRate, iconFilters, playbackRates, themeNames, validTheme } from '../extension/preferences.js';

test('each toolbar size has a source icon and each alternate theme has a filter', () => {
  for (const size of [16, 24, 32]) assert.ok(existsSync(`extension/icons/${size}.png`));
  assert.deepEqual(Object.keys(iconFilters).sort(), Object.keys(themeNames).filter(theme => theme !== defaultTheme).sort());
  assert.equal(validTheme('unknown'), defaultTheme);
});

test('the speed menu exposes the full requested range', () => {
  for (const rate of [.1, .25, 2.5, 3, 4]) assert.ok(playbackRates.includes(rate));
  assert.equal(formatPlaybackRate(.1), '0.10×');
});
