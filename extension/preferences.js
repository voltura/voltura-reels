export const themeNames = Object.freeze({
  midnight: 'Midnight',
  'modern-black': 'Modern Black',
  'modern-metallic': 'Modern Metallic',
  'retro-wood': 'Retro Wood',
  forest: 'Forest',
  matrix: 'Matrix',
  'blood-red': 'Blood Red',
  'burnt-orange': 'Burnt Orange',
  'golden-god': 'Golden God',
  'pink-panther': 'Pink Panther',
});

export const defaultTheme = 'midnight';
export const themeKey = 'theme';

export const iconFilters = Object.freeze({
  'modern-black': 'grayscale(1)',
  'modern-metallic': 'hue-rotate(-19deg) saturate(.44)',
  'retro-wood': 'hue-rotate(170deg) saturate(.6)',
  forest: 'hue-rotate(-75deg) saturate(.6)',
  matrix: 'hue-rotate(-105deg)',
  'blood-red': 'hue-rotate(125deg)',
  'burnt-orange': 'hue-rotate(158deg)',
  'golden-god': 'hue-rotate(187deg)',
  'pink-panther': 'hue-rotate(90deg) saturate(.8)',
});

export function validTheme(value) {
  return Object.hasOwn(themeNames, value) ? value : defaultTheme;
}

export const playbackRates = Object.freeze([
  0.10, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
]);

export function formatPlaybackRate(rate) {
  return `${rate === 0.1 ? '0.10' : rate}×`;
}
