const icons = {
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h8"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h2m3 0h5"/>',
  spark: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 16h2m3 0h2m3 0h2"/>',
  marks: '<path d="M3 13h18M7 6v12M17 6v12m-7-8 2 3-2 3"/>',
  handles:
    '<path d="M3 12h3m4 0h4m4 0h3"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="6" width="4" height="12" rx="1"/>',
  landscape: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/>',
  portrait: '<rect x="6" y="2.5" width="12" height="19" rx="2"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeoff:
    '<path d="M3 3l18 18M10 6a11 11 0 0 1 2-.2c6.5 0 10 6.2 10 6.2a16 16 0 0 1-3 3.5M6 7.6A16 16 0 0 0 2 12s3.5 6 10 6a11 11 0 0 0 4-.8"/>',
  camera:
    '<path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  like: '<path d="M7 10h-4v10h4m0-10 4-7c2 0 3.5 1.4 3 4l-.5 3H19a2 2 0 0 1 2 2l-1.5 6a2 2 0 0 1-2 2H7Z"/>',
  message: '<path d="M20 15.6a8.5 8.5 0 1 0-3.5 3.5L21 21l-1-5.4Z"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
  play: '<path d="m8 5 12 7-12 7V5Z"/>',
  pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>',
  previous: '<path d="M5 6v12m12-12-6 6 6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  next: '<path d="M19 6v12M7 6l6 6-6 6"/>',
  'seek-back': '<path d="M7 4 3 8l4 4M3 8h10a6 6 0 0 1 0 12H9"/>',
  'seek-forward': '<path d="m17 4 4 4-4 4m4-4H11a6 6 0 0 0 0 12h4"/>',
  repeat: '<path d="m16 3 4 4-4 4M4 11V9a2 2 0 0 1 2-2h14M8 21l-4-4 4-4m12 0v2a2 2 0 0 1-2 2H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  share: '<path d="M14 5l7 6-7 6v-4C8 13 5 15 3 19c0-7 4-10 11-10V5Z"/>',
  more: '<path d="M5 12h.01m7 0h.01m7 0h.01" stroke-width="3"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  mute: '<path d="M3 9v6h4l4 4V5L7 9H3Zm12 1 5 5m0-5-5 5"/>',
  sound: '<path d="M3 9v6h4l4 4V5L7 9H3Zm12 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  cc: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M10 10a2.3 2.3 0 1 0 0 4m7-4a2.3 2.3 0 1 0 0 4"/>',
  maximize: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  minimize: '<path d="M4 9h5V4m11 5h-5V4M9 20v-5H4m11 5v-5h5"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 6v4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

export function paintIcon(element, name) {
  if (element.dataset.icon === name && element.firstElementChild?.localName === 'svg') return;
  element.dataset.icon = name;
  element.querySelector('svg')?.remove();
  element.insertAdjacentHTML(
    'afterbegin',
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`,
  );
}
