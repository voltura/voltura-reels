import {
  defaultTheme,
  iconFilters,
  playerSetting,
  playerSettings,
  themeKey,
  themeNames,
  validTheme,
} from './preferences.js';
import { languageKey, languages, resolveLanguage, translator } from './languages.js';
import { shortsEnabled, shortsPermission, syncShortsMessage } from './shorts-access.js';

const select = document.querySelector('#theme');
const status = document.querySelector('#status');
const trigger = document.querySelector('#language-trigger');
const options = document.querySelector('#language-options');
let language = 'auto';
let message;

function setStatus(key) {
  message = key;
  status.hidden = !message;
  status.textContent = message ? translator(resolveLanguage(language))(message) : '';
}

function flag(image, code) {
  image.src = `flags/${languages.find((item) => item.code === code).flag}.svg`;
}

function showLanguage() {
  const locale = resolveLanguage(language);
  const text = translator(locale);
  document.documentElement.lang = locale;
  for (const element of document.querySelectorAll('[data-message]'))
    element.textContent = text(element.dataset.message);
  const automatic = resolveLanguage('auto');
  const automaticName = text('Automatic ({0})').replace(
    '{0}',
    languages.find((item) => item.code === automatic).name,
  );
  document.querySelector('#language-current').textContent =
    language === 'auto' ? automaticName : languages.find((item) => item.code === locale).name;
  flag(trigger.querySelector('img'), locale);
  for (const button of options.querySelectorAll('button')) {
    const code = button.dataset.language;
    if (code === 'auto') {
      flag(button.querySelector('img'), automatic);
      button.querySelector('.language-name').textContent = automaticName;
    }
    button.setAttribute('aria-pressed', String(code === language));
    button.querySelector('.selected').hidden = code !== language;
  }
  setStatus(message);
}

function openLanguages(open, restoreFocus = false) {
  options.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (open) options.querySelector('[aria-pressed="true"]')?.focus();
  else if (restoreFocus) trigger.focus();
}

for (const item of [{ code: 'auto', name: '' }, ...languages]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.language = item.code;
  const image = new Image(21, 14);
  image.alt = '';
  if (item.flag) flag(image, item.code);
  const name = document.createElement('span');
  name.className = 'language-name';
  if (item.flag) name.lang = item.code;
  name.textContent = item.name;
  const selected = document.createElement('span');
  selected.className = 'selected';
  selected.textContent = '✓';
  selected.setAttribute('aria-hidden', 'true');
  button.append(image, name, selected);
  button.addEventListener('click', async () => {
    openLanguages(false, true);
    setStatus();
    try {
      await chrome.storage.local.set({ [languageKey]: item.code });
      language = item.code;
      showLanguage();
    } catch {
      setStatus('Could not save settings');
    }
  });
  options.append(button);
}
trigger.addEventListener('click', () => openLanguages(options.hidden, !options.hidden));
document.addEventListener('pointerdown', (event) => {
  if (!options.hidden && !options.contains(event.target) && !trigger.contains(event.target))
    openLanguages(false);
});
document.addEventListener('keydown', (event) => {
  if (options.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    openLanguages(false, true);
  }
  const buttons = Array.from(options.querySelectorAll('button'));
  const index = buttons.indexOf(document.activeElement);
  if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
for (const [value, name] of Object.entries(themeNames)) {
  select.add(new Option(name, value));
}

function showTheme(theme) {
  select.value = theme;
  document.documentElement.dataset.skin = theme;
  document.querySelector('#brand').style.filter = iconFilters[theme] ?? 'none';
}

let savedTheme = defaultTheme;
const playbackKeys = Object.keys(playerSettings);
const savedPlayback = {};
for (const [key, choices] of Object.entries(playerSettings)) {
  const field = document.getElementById(key);
  for (const [value, label] of Object.entries(choices)) {
    const option = new Option(label, value);
    option.dataset.message = label;
    field.add(option);
  }
  savedPlayback[key] = field.value = playerSetting(key);
  field.addEventListener('change', async () => {
    const value = field.value;
    field.disabled = true;
    setStatus();
    try {
      await chrome.storage.local.set({ [key]: value });
      savedPlayback[key] = value;
    } catch {
      field.value = savedPlayback[key];
      setStatus('Could not save settings');
    } finally {
      field.disabled = false;
      field.focus();
    }
  });
}

try {
  const stored = await chrome.storage.local.get([themeKey, languageKey, ...playbackKeys]);
  savedTheme = validTheme(stored[themeKey]);
  language = languages.some((item) => item.code === stored[languageKey]) ? stored[languageKey] : 'auto';
  for (const key of playbackKeys) {
    const field = document.getElementById(key);
    savedPlayback[key] = field.value = playerSetting(key, stored[key]);
    field.disabled = false;
  }
  select.disabled = false;
  trigger.disabled = false;
} catch {
  setStatus('Settings unavailable');
}
showTheme(savedTheme);
showLanguage();

select.addEventListener('change', async () => {
  const selectedTheme = validTheme(select.value);
  select.disabled = true;
  setStatus();
  showTheme(selectedTheme);
  try {
    await chrome.storage.local.set({ [themeKey]: selectedTheme });
    savedTheme = selectedTheme;
  } catch {
    showTheme(savedTheme);
    setStatus('Could not save settings');
  } finally {
    select.disabled = false;
    select.focus();
  }
});

const shorts = document.querySelector('#enable-shorts');
try {
  const stored = await chrome.storage.local.get(shortsEnabled);
  shorts.checked = Boolean(stored[shortsEnabled]) && await chrome.permissions.contains(shortsPermission);
  shorts.disabled = false;
} catch {
  setStatus('Settings unavailable');
}

shorts.addEventListener('change', async () => {
  const enable = shorts.checked;
  shorts.disabled = true;
  setStatus();
  try {
    const changed = enable
      ? await chrome.permissions.request(shortsPermission)
      : await chrome.permissions.remove(shortsPermission);
    const enabled = await chrome.runtime.sendMessage({ type: syncShortsMessage });
    if (typeof enabled !== 'boolean') throw new Error('Could not apply Shorts access');
    shorts.checked = enabled;
    if (!changed && enable && !enabled) setStatus('YouTube access was not granted');
  } catch {
    shorts.checked = !enable;
    setStatus('Could not save settings');
  } finally {
    shorts.disabled = false;
  }
});
