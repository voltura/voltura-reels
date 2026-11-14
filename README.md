# Voltura Reel Player

A Chrome extension for Facebook Reels with fullscreen playback, precise seeking, variable speed, segment repeat, and zoom.

Open a Facebook reel and select the fullscreen icon on the video. Use the outer chevrons to change reels and the inner chevrons to step by 0.1 seconds. Open the extension toolbar icon to change the theme, language, control bar width, segment repeat style, or control visibility. Automatic width gives longer videos more timeline space. Choose Wide to use the available space for every reel.

Select the range icon to create a segment, then drag its handles. Shift-drag on the timeline to select a range directly. With the optional A/B style, set each endpoint at the playhead using the buttons or the bracket keys. Repeat is off by default. Turn it on to repeat the selected segment or, with no selection, the whole reel. Hover over a control to see its keyboard shortcuts.

The player interface supports the 16 languages available in Voltura Music. Facebook actions use Facebook’s own controls. The native controls adapter covers English and Swedish layouts.

The extension lives on `main`. The product site is published from `gh-pages` at [reels.voltura.se](https://reels.voltura.se/).

Run `npm run check`, `npm test`, and `npm run build` from the repository root. Load `dist/extension` as an unpacked extension in Chrome for local development.
