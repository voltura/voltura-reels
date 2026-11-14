import { defaultTheme, iconFilters, themeKey, themeNames, validTheme } from './preferences.js';

const select = document.querySelector('#theme');
const status = document.querySelector('#status');
for (const [value, name] of Object.entries(themeNames)) {
  select.add(new Option(name, value));
}

function showTheme(theme) {
  select.value = theme;
  document.documentElement.dataset.skin = theme;
  document.querySelector('#brand').style.filter = iconFilters[theme] ?? 'none';
}

let savedTheme = defaultTheme;
try {
  const stored = await chrome.storage.local.get(themeKey);
  savedTheme = validTheme(stored[themeKey]);
  select.disabled = false;
} catch {
  status.textContent = 'Theme settings are unavailable.';
  status.hidden = false;
}
showTheme(savedTheme);

select.addEventListener('change', async () => {
  const selectedTheme = validTheme(select.value);
  select.disabled = true;
  status.hidden = true;
  showTheme(selectedTheme);
  try {
    await chrome.storage.local.set({ [themeKey]: selectedTheme });
    savedTheme = selectedTheme;
  } catch {
    showTheme(savedTheme);
    status.textContent = 'Could not save the theme.';
    status.hidden = false;
  } finally {
    select.disabled = false;
    select.focus();
  }
});
