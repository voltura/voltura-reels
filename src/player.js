import markup from './player.html';
import css from './player.css';
import themes from '../extension/themes.css';
import { defaultTheme, formatPlaybackRate, playbackRates, playerSetting, playerSettings, themeKey, validTheme } from '../extension/preferences.js';
import { languageKey, resolveLanguage, translator } from '../extension/languages.js';
import { paintIcon } from './icons.js';
import { clamp, panBounds, seekTarget, tenth, timeText } from './media.js';
import { isEnabled, nativeAction, reelControl, reelMetadata, reelMuteControl, setReelVolume } from './facebook.js';

const fullscreenAttribute = 'data-voltura-reel-fullscreen';
const videoAttribute = 'data-voltura-reel-video';
const pathAttribute = 'data-voltura-reel-path';
const panKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const themeStyles = themes.replace(/:root(\[data-skin="[^"]+"\])/g, ':host($1)');
const playbackKeys = Object.keys(playerSettings);

export class ReelPlayer {
  constructor(schedule) {
    this.schedule = schedule;
    this.documentRoot = document.documentElement;
    this.host = document.createElement('voltura-reel-player');
    this.host.dataset.skin = defaultTheme;
    this.ui = this.host.attachShadow({ mode: 'open' });
    const style = new CSSStyleSheet();
    style.replaceSync(themeStyles + '\n' + css);
    this.ui.adoptedStyleSheets = [style];
    this.ui.innerHTML = markup;
    this.stage = this.ui.querySelector('.stage');
    this.layout = this.ui.querySelector('.player-layout');
    this.launch = this.ui.querySelector('.launch');
    this.viewport = this.ui.querySelector('.viewport');
    this.dock = this.ui.querySelector('.dock');
    this.dock.dataset.width = playerSetting('dockWidth');
    this.loopStyle = playerSetting('loopStyle');
    this.scrubber = this.ui.querySelector('.scrubber');
    this.timeline = this.get('timeline');
    this.listeners = new AbortController();
    this.path = [];
    this.active = false;
    this.hiddenOverlay = false;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.connect();
    this.documentRoot.append(this.host);
    this.setLanguage();
    chrome.storage.local.get([themeKey, languageKey, ...playbackKeys]).then(values => {
      this.setTheme(values[themeKey]);
      this.setLanguage(values[languageKey]);
      for (const key of playbackKeys) this.setPlayerSetting(key, values[key]);
    }).catch(() => {});
  }

  get(id) { return this.ui.getElementById(id); }
  get video() { return this.reel?.video; }
  get duration() { return Number.isFinite(this.video?.duration) ? this.video.duration : 0; }
  get position() { return this.requestedTime ?? this.video?.currentTime ?? 0; }

  on(target, type, handler, options) {
    target.addEventListener(type, handler, { ...options, signal: this.listeners.signal });
  }

  setTheme(theme) { this.host.dataset.skin = validTheme(theme); }

  setPlayerSetting(key, value) {
    const setting = playerSetting(key, value);
    if (key === 'dockWidth') this.dock.dataset.width = setting;
    if (key === 'controlsVisibility') {
      this.controlsVisibility = setting;
      this.reveal();
    }
    if (key === 'loopStyle' && setting !== this.loopStyle) {
      const focus = this.ui.activeElement;
      this.loopStyle = setting;
      this.gesture = undefined;
      if (this.loop && !this.hasLoop && setting === 'handles') this.loop = undefined;
      if (this.active) {
        this.renderLoop();
        if (focus?.closest('[hidden]')) this.get(setting === 'marks' ? 'mark-start' : 'select-range').focus();
      }
    }
  }

  setLanguage(preference) {
    this.host.lang = resolveLanguage(preference);
    this.translate = translator(this.host.lang);
    for (const element of this.ui.querySelectorAll('[aria-label]')) {
      const message = element.dataset.message ?? element.getAttribute('aria-label');
      if (element.matches('button')) this.label(element, message);
      else {
        element.dataset.message = message;
        element.setAttribute('aria-label', this.translate(message));
      }
    }
    this.ui.querySelector('[data-text="Volume"]').textContent = this.translate('Volume');
    this.applyZoom();
  }

  update(reel) {
    const changed = this.video !== reel.video || this.reel.key !== reel.key;
    if (changed) {
      const sameReel = this.reel?.key === reel.key;
      this.unpinVideo();
      this.mediaListeners?.abort();
      this.clearNavigation();
      this.stopHold();
      this.reel = reel;
      this.requestedTime = undefined;
      this.showTenths = false;
      if (!sameReel) this.captionExpanded = this.captionWasExpanded = false;
      if (!sameReel || !this.commentsState) this.loop = undefined;
      if (!sameReel) this.repeatEnabled = false;
      this.gesture = undefined;
      this.rangeDrag = undefined;
      this.pan = undefined;
      this.viewport.classList.remove('panning');
      this.zoom = 1;
      this.panX = this.panY = 0;
      this.bindVideo();
      if (this.active) this.pinVideo();
    } else {
      this.reel = reel;
    }
    this.launch.hidden = this.active;
    if (this.active) {
      this.applyNativeRepeat();
      this.render();
      this.applyZoom();
    } else {
      this.positionLauncher(reel);
    }
  }

  positionLauncher(reel) {
    const margin = 12;
    const navigation = reelControl(reel, 'previous') ?? reelControl(reel, 'next');
    const rail = navigation?.getBoundingClientRect();
    const size = rail && Math.min(rail.width, rail.height) || 44;
    const right = Math.max(margin, innerWidth - margin - size);
    const top = Math.max(margin, reel.bounds.top + 8);
    const railLeft = rail && clamp(rail.left + (rail.width - size) / 2, margin, right);
    const fitsBesideVideo = right >= reel.bounds.right + 8;
    let left = right;
    let y = top;

    if (rail && railLeft >= reel.bounds.right + 8 && rail.top >= top + size + 8) {
      left = railLeft;
    } else if (!fitsBesideVideo) {
      // On tight layouts, use the space above the arrows when they overlap the reel.
      if (rail && rail.top >= top + size + 24) {
        left = railLeft;
        y = rail.top - size - margin;
      } else {
        left = reel.bounds.right - size - 16;
        y = reel.bounds.top + 116;
      }
    }

    this.launch.style.setProperty('--launch-size', `${size}px`);
    this.launch.style.left = `${clamp(left, margin, right)}px`;
    this.launch.style.top = `${clamp(y, margin, Math.max(margin, innerHeight - margin - size))}px`;
  }

  waitForReel() {
    if (!this.active) this.launch.hidden = true;
  }

  bindVideo() {
    this.mediaListeners = new AbortController();
    const { signal } = this.mediaListeners;
    const video = this.video;
    for (const event of ['loadedmetadata', 'durationchange', 'loadeddata', 'play', 'pause', 'volumechange', 'ratechange', 'progress']) {
      video.addEventListener(event, () => {
        if (event === 'loadedmetadata' && this.active) this.applyMediaPreferences();
        if (!this.active) return;
        if (event === 'play' || event === 'pause' || event === 'volumechange') this.applyAudioPreference();
        if (event === 'play') this.showTenths = false;
        this.render();
        if (event === 'play' || event === 'pause') this.reveal();
        if (event === 'loadedmetadata') this.applyZoom();
      }, { signal });
    }
    video.addEventListener('seeked', () => {
      if (!video.seeking) this.requestedTime = undefined;
      if (this.active) {
        this.enforceLoop();
        this.render();
      }
    }, { signal });
    video.addEventListener('timeupdate', () => this.enforceLoop(), { signal });
    video.addEventListener('ended', () => {
      if (!this.active) return;
      if (this.repeatEnabled) {
        this.seek(this.hasLoop ? this.loop.start : 0);
        void video.play().catch(() => {});
      } else {
        this.render();
        this.reveal();
      }
    }, { signal });
    video.textTracks.addEventListener('addtrack', () => { if (this.active) this.render(); }, { signal });
    video.textTracks.addEventListener('removetrack', () => { if (this.active) this.render(); }, { signal });
  }

  applyMediaPreferences() {
    const video = this.video;
    if (this.rate !== undefined) video.playbackRate = this.rate;
    if (this.volume !== undefined) video.volume = this.volume;
    this.applyAudioPreference();
  }

  applyAudioPreference() {
    if (this.fallbackMuted !== undefined && this.video.muted !== this.fallbackMuted) {
      this.video.muted = this.fallbackMuted;
    }
  }

  setMuted(muted) {
    const native = reelMuteControl(this.reel);
    if (native) {
      // Facebook keeps its own mute preference and uses it when playback resumes.
      this.fallbackMuted = undefined;
      if (native.muted !== muted) native.button.click();
      return;
    }
    this.fallbackMuted = muted;
    this.applyAudioPreference();
  }

  pinVideo() {
    if (!this.video?.isConnected) return;
    for (let element = this.video.parentElement; element && element !== this.documentRoot; element = element.parentElement) {
      element.setAttribute(pathAttribute, '');
      this.path.push(element);
    }
    this.video.setAttribute(videoAttribute, '');
    this.nativeRepeat = this.video.loop;
    this.applyNativeRepeat();
    this.applyMediaPreferences();
    this.applyZoom();
  }

  unpinVideo() {
    for (const element of this.path) element.removeAttribute(pathAttribute);
    this.path = [];
    if (!this.video) return;
    if (this.nativeRepeat !== undefined) {
      this.video.loop = this.nativeRepeat;
      this.nativeRepeat = undefined;
    }
    this.video.removeAttribute(videoAttribute);
    for (const name of ['--voltura-zoom', '--voltura-pan-x', '--voltura-pan-y']) this.video.style.removeProperty(name);
  }

  enter() {
    if (this.active || !this.video?.isConnected || document.fullscreenElement) return;
    const fullscreen = this.documentRoot.requestFullscreen({ navigationUI: 'hide' });
    this.fallbackMuted = undefined;
    this.volume = undefined;
    this.requestedTime = undefined;
    this.active = true;
    this.documentRoot.setAttribute(fullscreenAttribute, '');
    this.launch.hidden = true;
    this.stage.hidden = false;
    if (this.commentsState?.key === this.reel.key) {
      const saved = this.commentsState;
      this.zoom = saved.zoom;
      this.panX = saved.x;
      this.panY = saved.y;
      this.seek(saved.time);
      if (saved.paused) this.video.pause();
      else void this.video.play().catch(() => {});
    } else {
      this.zoom = 1;
      this.panX = this.panY = 0;
    }
    this.commentsState = undefined;
    this.pinVideo();
    this.render();
    this.reveal();
    this.viewport.focus({ preventScroll: true });
    fullscreen.then(() => {
      if (!this.active && document.fullscreenElement === this.documentRoot) void document.exitFullscreen();
    }).catch(() => {
      if (this.active) void this.leave();
    });
    this.frame = requestAnimationFrame(() => this.tick());
  }

  leave() {
    if (!this.active) return Promise.resolve();
    this.active = false;
    this.stopHold();
    this.clearNavigation();
    clearTimeout(this.revealTimer);
    clearTimeout(this.noticeTimer);
    cancelAnimationFrame(this.frame);
    this.gesture = this.rangeDrag = this.pan = undefined;
    this.scrubbing = false;
    this.viewport.classList.remove('panning');
    this.stage.hidden = true;
    this.ui.querySelector('.osd').hidden = true;
    this.launch.hidden = false;
    this.closePopovers();
    this.unpinVideo();
    this.documentRoot.removeAttribute(fullscreenAttribute);
    this.launch.focus({ preventScroll: true });
    return document.fullscreenElement === this.documentRoot ? document.exitFullscreen().catch(() => {}) : Promise.resolve();
  }

  destroy() {
    void this.leave();
    this.listeners.abort();
    this.mediaListeners?.abort();
    this.host.remove();
  }

  announce(message) {
    const notice = this.ui.querySelector('.osd');
    clearTimeout(this.noticeTimer);
    notice.textContent = this.translate(message);
    notice.hidden = false;
    this.noticeTimer = setTimeout(() => { notice.hidden = true; }, 2000);
  }

  reveal() {
    if (!this.active) return;
    clearTimeout(this.revealTimer);
    this.dock.classList.remove('faded');
    this.layout.classList.remove('overlay-toggle-faded');
    if (this.controlsVisibility === 'always') return;
    this.revealTimer = setTimeout(() => {
      const menuOpen = !this.get('rates').hidden || !this.get('volume-popover').hidden;
      const keyboardFocus = this.ui.activeElement !== this.viewport && this.ui.activeElement?.matches(':focus-visible');
      if (this.gesture || this.rangeDrag || this.pan || this.hold || menuOpen || keyboardFocus) return;
      this.layout.classList.add('overlay-toggle-faded');
      if (!this.dock.matches(':hover') && !this.video.paused && !this.video.ended) this.dock.classList.add('faded');
    }, 1550);
  }

  tick() {
    if (!this.active) return;
    this.enforceLoop();
    if (this.video && !this.video.paused && !this.video.seeking) {
      this.renderTime();
    }
    this.frame = requestAnimationFrame(() => this.tick());
  }

  enforceLoop() {
    const video = this.video;
    const loop = this.loop;
    if (!this.active || !video || video.paused || video.seeking || !this.repeatEnabled || !this.hasLoop ||
        this.gesture || this.rangeDrag || this.scrubbing) return;
    if (video.currentTime < loop.start - 0.025 || video.currentTime >= loop.end) this.seek(loop.start);
  }

  seek(time, direction = 0) {
    if (!this.video || !this.duration) return;
    const target = seekTarget(this.video.seekable, clamp(time, 0, Math.max(0, this.duration - 0.001)), direction);
    if (target === null) return;
    // Scrubbing does not change whether repeat is enabled. Playback resumes
    // inside the selected range when the user finishes moving the playhead.
    this.requestedTime = target;
    this.video.currentTime = target;
    this.renderTime();
  }

  resumeInsideLoop() {
    if (this.repeatEnabled && this.hasLoop && (this.position < this.loop.start || this.position >= this.loop.end)) {
      this.seek(this.loop.start);
    }
  }

  step(amount) {
    this.showTenths = this.video.paused && Math.abs(amount) < 5;
    const target = this.position + amount;
    if (this.repeatEnabled && this.hasLoop && (target < this.loop.start || target >= this.loop.end)) {
      this.seek(amount > 0 ? this.loop.start : Math.max(this.loop.start, this.loop.end - 0.1));
    } else this.seek(target, Math.sign(amount));
  }

  togglePlay() {
    this.applyAudioPreference();
    if (!this.video.paused) {
      this.video.pause();
      return;
    }
    this.resumeInsideLoop();
    void this.video.play().catch(() => this.announce('Playback unavailable'));
  }

  startHold(name, amount) {
    if (this.get('forward').disabled) return;
    this.stopHold();
    this.step(amount);
    const started = performance.now();
    this.hold = name;
    const repeat = () => {
      const elapsed = performance.now() - started;
      const increment = elapsed >= 2000 ? 1 : elapsed >= 1000 ? 0.5 : 0.1;
      this.step(Math.sign(amount) * increment);
      this.holdTimer = setTimeout(repeat, 110);
    };
    this.holdTimer = setTimeout(repeat, 300);
    this.reveal();
  }

  stopHold() {
    clearTimeout(this.holdTimer);
    this.hold = undefined;
  }

  selectLoop() {
    if (this.timeline.disabled) return;
    const length = Math.min(this.duration, Math.max(4, this.duration * 0.08));
    const start = clamp(tenth(this.position), 0, this.duration - length);
    this.loop = { start, end: start + length };
    this.updateRepeat();
  }

  applyNativeRepeat() {
    if (this.nativeRepeat === undefined) return;
    const loopWholeReel = this.repeatEnabled && !this.hasLoop;
    if (this.video.loop !== loopWholeReel) this.video.loop = loopWholeReel;
  }

  toggleRepeat() {
    if (this.get('repeat').disabled) return;
    this.repeatEnabled = !this.repeatEnabled;
    this.updateRepeat();
  }

  updateRepeat() {
    this.applyNativeRepeat();
    if (!this.video.paused) this.resumeInsideLoop();
    this.renderLoop();
  }

  get hasLoop() { return this.loop?.start != null && this.loop?.end != null; }

  setLoopMark(edge) {
    if (this.loopStyle !== 'marks' || this.timeline.disabled) return;
    const time = clamp(tenth(this.position), 0, this.duration);
    const start = edge === 'start' ? time : this.loop?.start;
    const end = edge === 'end' ? time : this.loop?.end;
    const complete = start !== undefined && end !== undefined;
    if (complete && tenth(end - start) < 0.2) {
      this.announce('Keep A at least 0.2 seconds before B');
      return;
    }
    this.loop = { start, end };
    this.updateRepeat();
  }

  moveHandle(edge, time) {
    if (!this.loop) return;
    const min = edge === 'start' ? 0 : Math.min(this.duration, this.loop.start + 0.2);
    const max = edge === 'end' ? this.duration : Math.max(0, this.loop.end - 0.2);
    const position = clamp(tenth(time), min, max);
    if (position === this.loop[edge]) return;
    this.loop[edge] = position;
    this.updateRepeat();
  }

  clearLoop() {
    const focusWasHidden = this.ui.activeElement === this.get('clear') ||
      this.ui.activeElement?.classList.contains('handle');
    this.loop = undefined;
    this.updateRepeat();
    if (focusWasHidden) this.get(this.loopStyle === 'marks' ? 'mark-start' : 'select-range').focus();
  }

  clearNavigation() {
    clearTimeout(this.navigationTimer);
    this.navigating = false;
  }

  navigate(action) {
    if (this.navigating || !nativeAction(this.reel, action)) return;
    this.navigating = true;
    this.renderNavigation();
    this.navigationTimer = setTimeout(() => {
      this.navigating = false;
      this.renderNavigation();
    }, 1800);
    this.schedule();
  }

  async openFacebookAction(action) {
    const reel = this.reel;
    if (!isEnabled(reelControl(reel, action))) return;
    if (action === 'comments') {
      this.commentsState = {
        key: reel.key, time: this.position, paused: this.video.paused,
        zoom: this.zoom, x: this.panX, y: this.panY,
      };
    }
    await this.leave();
    if (this.reel.key !== reel.key) return;
    nativeAction(this.reel, action);
  }

  async saveOnFacebook() {
    const reel = this.reel;
    if (this.saving || !nativeAction(reel, 'more')) return;
    this.saving = true;
    try {
      for (let tries = 0; tries < 16; tries++) {
        if (!this.active || this.video !== reel.video || this.reel.key !== reel.key) return;
        const entry = Array.from(document.querySelectorAll('[role="menuitem"]')).find(item =>
          item.getClientRects().length && /^(save reel|save video|spara reel|spara video|spara videoklipp)$/i.test(item.textContent.trim()));
        if (entry) {
          entry.click();
          this.announce('Save opened on Facebook');
          // Some layouts open a collection picker. Give it focus in the native viewer.
          setTimeout(() => {
            if (this.active && document.querySelector('[role="dialog"][aria-modal="true"]')) void this.leave();
          }, 250);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await this.leave();
    } finally {
      this.saving = false;
    }
  }

  async capture() {
    const video = this.video;
    if (!video.paused || video.seeking || video.readyState < 2 || !video.videoWidth || video.mediaKeys) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    try {
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Empty frame');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `reel-${timeText(video.currentTime).replace(':', 'm')}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      if (this.active) this.announce('Frame saved');
    } catch {
      if (this.active) this.announce('Frame capture unavailable');
    }
  }

  applyZoom() {
    const video = this.video;
    if (!video || !this.active) return;
    const [maxX, maxY] = panBounds(innerWidth, innerHeight, video.videoWidth, video.videoHeight, this.zoom);
    this.panX = clamp(this.panX, -maxX, maxX);
    this.panY = clamp(this.panY, -maxY, maxY);
    video.style.setProperty('--voltura-zoom', this.zoom);
    video.style.setProperty('--voltura-pan-x', `${this.panX}px`);
    video.style.setProperty('--voltura-pan-y', `${this.panY}px`);
    this.viewport.classList.toggle('zoomed', this.zoom > 1);
    const reset = this.get('zoom-reset');
    if (this.zoom === 1 && this.ui.activeElement === reset) this.viewport.focus();
    reset.hidden = this.zoom === 1;
    reset.querySelector('.control-value').textContent = `${this.zoom.toFixed(1)}×`;
    this.label(reset, 'Reset zoom');
  }

  zoomAt(value, x = innerWidth / 2, y = innerHeight / 2) {
    const zoom = clamp(value, 1, 10);
    const ratio = zoom / this.zoom;
    const dx = x - innerWidth / 2;
    const dy = y - innerHeight / 2;
    this.panX = dx - (dx - this.panX) * ratio;
    this.panY = dy - (dy - this.panY) * ratio;
    this.zoom = zoom;
    this.applyZoom();
    this.reveal();
  }

  renderNavigation() {
    for (const action of ['previous', 'next']) {
      const button = this.get(action);
      const disabled = this.navigating || !isEnabled(reelControl(this.reel, action));
      if (disabled !== button.disabled) button.disabled = disabled;
    }
  }

  renderTime() {
    const position = this.position;
    const percent = `${this.duration ? clamp(position / this.duration, 0, 1) * 100 : 0}%`;
    this.ui.querySelector('.played').style.width = percent;
    this.ui.querySelector('.indicator').style.left = percent;
    const elapsed = timeText(position, this.video.paused && this.showTenths);
    const duration = this.duration ? ` / ${timeText(this.duration, false)}` : '';
    if (this.get('elapsed').textContent !== elapsed) this.get('elapsed').textContent = elapsed;
    if (this.get('duration').textContent !== duration) this.get('duration').textContent = duration;
    if (Number(this.timeline.max) !== this.duration) this.timeline.max = this.duration;
    if (Math.abs(Number(this.timeline.value) - position) >= 0.05) this.timeline.value = position;
    if (this.timeline.getAttribute('aria-valuetext') !== elapsed) this.timeline.setAttribute('aria-valuetext', elapsed);
  }

  renderLoop() {
    const { loop, duration } = this;
    const exists = Boolean(loop && duration);
    const complete = Boolean(duration && this.hasLoop);
    const marks = this.loopStyle === 'marks';
    const band = this.ui.querySelector('.loop-band');
    const readout = this.ui.querySelector('.loop-readout');
    const repeat = this.get('repeat');
    const selectRange = this.get('select-range');
    this.get('loop-marks').hidden = !marks;
    selectRange.hidden = marks;
    selectRange.disabled = this.timeline.disabled;
    repeat.disabled = !duration;
    repeat.setAttribute('aria-pressed', String(Boolean(this.repeatEnabled)));
    this.label(repeat, complete ? 'Repeat selected segment' : 'Repeat whole reel');
    band.hidden = !complete;
    readout.hidden = this.get('clear').hidden = !exists;
    for (const edge of ['start', 'end']) {
      const handle = this.get(`loop-${edge}`);
      const marker = this.get(`marker-${edge}`);
      const button = this.get(`mark-${edge}`);
      const time = exists ? loop[edge] : undefined;
      marker.hidden = !marks || time === undefined;
      if (!marker.hidden) marker.style.left = `${time / duration * 100}%`;
      button.disabled = this.timeline.disabled;
      button.setAttribute('aria-pressed', String(time !== undefined));
      handle.hidden = marks || !complete;
      if (handle.hidden) continue;
      handle.style.left = `${loop[edge] / duration * 100}%`;
      handle.setAttribute('aria-valuenow', loop[edge]);
      handle.setAttribute('aria-valuemin', edge === 'start' ? 0 : Math.min(duration, loop.start + 0.2));
      handle.setAttribute('aria-valuemax', edge === 'end' ? duration : Math.max(0, loop.end - 0.2));
      handle.setAttribute('aria-valuetext', timeText(loop[edge]));
    }
    if (!exists) return;
    if (complete) {
      band.style.left = `${loop.start / duration * 100}%`;
      band.style.width = `${(loop.end - loop.start) / duration * 100}%`;
    }
    band.classList.toggle('active', this.repeatEnabled);
    readout.classList.toggle('active', complete && this.repeatEnabled);
    const start = loop.start === undefined ? '–' : timeText(loop.start);
    const end = loop.end === undefined ? '–' : timeText(loop.end);
    const text = `${start}–${end}`;
    if (readout.textContent !== text) readout.textContent = text;
  }

  render() {
    const video = this.video;
    this.renderNavigation();
    const expansion = clamp((this.duration - 60) / 240, 0, 1);
    this.dock.style.setProperty('--dock-expansion', expansion);
    this.renderTime();
    const seekable = Boolean(this.duration && video.seekable.length && video.seekable.end(video.seekable.length - 1) > video.seekable.start(0));
    for (const element of [this.timeline, this.get('back'), this.get('forward')]) {
      if (element.disabled === seekable) element.disabled = !seekable;
    }
    this.renderLoop();
    this.get('frame').hidden = !video.paused;
    this.get('frame').disabled = video.seeking || video.readyState < 2 || Boolean(video.mediaKeys);
    const play = this.get('play');
    paintIcon(play, video.paused ? 'play' : 'pause');
    this.label(play, video.paused ? 'Play' : 'Pause');
    const mute = this.get('mute');
    paintIcon(mute, video.muted || !video.volume ? 'mute' : 'sound');
    this.label(mute, video.muted || !video.volume ? 'Unmute' : 'Mute');
    this.get('volume').value = Math.round(video.volume * 100);
    this.get('volume-value').textContent = `${Math.round(video.volume * 100)}%`;
    const rate = this.get('rate');
    const formattedRate = formatPlaybackRate(video.playbackRate);
    const rateValue = rate.querySelector('.control-value');
    if (rateValue.textContent !== formattedRate) rateValue.textContent = formattedRate;
    for (const button of this.get('rates').children) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === video.playbackRate));
    }
    const track = Array.from(video.textTracks).find(item => item.kind === 'captions' || item.kind === 'subtitles');
    const cc = this.get('cc');
    cc.hidden = !track;
    cc.setAttribute('aria-pressed', String(track?.mode === 'showing'));
    this.renderOverlay();
  }

  renderOverlay() {
    const overlay = this.get('overlay');
    paintIcon(overlay, this.hiddenOverlay ? 'eyeoff' : 'eye');
    this.label(overlay, this.hiddenOverlay ? 'Show reel information' : 'Hide reel information');
    overlay.setAttribute('aria-pressed', String(this.hiddenOverlay));
    this.layout.classList.toggle('social-hidden', this.hiddenOverlay);
    this.get('social').hidden = this.hiddenOverlay;
    const { owner, profile, photo, follow, caption, more } = reelMetadata(this.reel);
    this.captionSource = more;
    this.get('creator').hidden = this.hiddenOverlay || !(owner || caption);
    this.get('owner').parentElement.hidden = !owner;
    if (this.get('creator-name').textContent !== owner) this.get('creator-name').textContent = owner;
    if (profile && this.get('owner').getAttribute('href') !== profile) this.get('owner').href = profile;
    else if (!profile) this.get('owner').removeAttribute('href');
    const avatar = this.get('creator-photo');
    avatar.hidden = !photo || !owner;
    if (photo && avatar.getAttribute('src') !== photo) avatar.src = photo;
    else if (!photo) avatar.removeAttribute('src');
    const followState = this.get('creator-follow');
    followState.hidden = !follow;
    if (followState.textContent !== (follow ?? '')) followState.textContent = follow ?? '';
    if (this.get('caption').textContent !== caption) this.get('caption').textContent = caption;
    const expanded = Boolean(this.captionExpanded);
    this.get('creator').classList.toggle('expanded', expanded);
    const disclosure = this.get('caption-more');
    const captionBox = this.get('caption');
    const canExpand = Boolean(more) || captionBox.scrollHeight > captionBox.clientHeight;
    disclosure.hidden = !caption || !(canExpand || expanded || this.captionWasExpanded);
    disclosure.setAttribute('aria-expanded', String(expanded));
    const disclosureText = this.translate(expanded ? 'See less' : 'See more');
    if (disclosure.textContent !== disclosureText) disclosure.textContent = disclosureText;
    for (const action of ['like', 'comments', 'share', 'save', 'more']) {
      const native = reelControl(this.reel, action === 'save' ? 'more' : action);
      const button = this.get(action);
      button.hidden = !isEnabled(native);
      if (['like', 'comments', 'share'].includes(action)) {
        const count = native?.textContent.trim();
        let number = button.querySelector('.count');
        if (count && /^\d[\d\s.,]*\s*[\p{L}]*$/u.test(count)) {
          if (!number) {
            number = document.createElement('span');
            number.className = 'count';
            button.append(number);
          }
          if (number.textContent !== count) number.textContent = count;
        } else number?.remove();
      }
      if (action === 'like') this.get(action).setAttribute('aria-pressed', String(
        native?.getAttribute('aria-pressed') === 'true' || /^(unlike|sluta gilla)/i.test(native?.getAttribute('aria-label') ?? ''),
      ));
    }
  }

  label(element, key) {
    element.dataset.message = key;
    const translated = this.translate?.(key) ?? key;
    if (element.getAttribute('aria-label') !== translated) element.setAttribute('aria-label', translated);
    element.dataset.tip = translated;
    let tooltip = element.querySelector('.tooltip');
    if (!tooltip) {
      tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'tooltip-text';
      tooltip.append(title);
      for (const keycap of element.dataset.keys?.split('|') ?? []) {
        const key = document.createElement('kbd');
        key.textContent = keycap;
        if (keycap === '+') key.className = 'plus-key';
        tooltip.append(key);
      }
      element.append(tooltip);
    }
    const title = tooltip.firstElementChild;
    if (title.textContent !== translated) title.textContent = translated;
  }

  setMenu(id, trigger, open) {
    this.get(id).hidden = !open;
    this.get(trigger).setAttribute('aria-expanded', String(open));
  }

  closePopovers() {
    this.setMenu('rates', 'rate', false);
    this.setMenu('volume-popover', 'volume-button', false);
  }

  toggleMenu(id, trigger) {
    const open = this.get(id).hidden;
    this.closePopovers();
    this.setMenu(id, trigger, open);
    if (open && id === 'volume-popover') {
      reelMuteControl(this.reel)?.button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
    if (open) this.get(id).querySelector('[aria-pressed="true"],input')?.focus();
    this.reveal();
  }

  setCaptions() {
    const tracks = Array.from(this.video.textTracks).filter(track => track.kind === 'captions' || track.kind === 'subtitles');
    if (!tracks.length) return;
    const current = tracks.find(track => track.mode === 'showing');
    (current ?? tracks[0]).mode = current ? 'disabled' : 'showing';
    this.render();
  }

  connect() {
    for (const element of this.ui.querySelectorAll('[data-icon]')) paintIcon(element, element.dataset.icon);
    for (const element of this.ui.querySelectorAll('button[aria-label]')) this.label(element, element.getAttribute('aria-label'));
    const click = (id, action) => this.on(this.get(id), 'click', () => {
      action();
      this.reveal();
    });
    this.on(this.launch, 'click', () => this.enter());
    click('exit', () => void this.leave());
    click('exit-dock', () => void this.leave());
    click('play', () => this.togglePlay());
    click('frame', () => void this.capture());
    click('select-range', () => this.selectLoop());
    click('repeat', () => this.toggleRepeat());
    click('clear', () => this.clearLoop());
    for (const edge of ['start', 'end']) click(`mark-${edge}`, () => this.setLoopMark(edge));
    click('overlay', () => {
      this.hiddenOverlay = !this.hiddenOverlay;
      this.renderOverlay();
    });
    click('zoom-out', () => this.zoomAt(this.zoom / 1.25));
    click('zoom-in', () => this.zoomAt(this.zoom * 1.25));
    click('zoom-reset', () => this.zoomAt(1));
    for (const action of ['previous', 'next']) click(action, () => this.navigate(action));
    click('like', () => nativeAction(this.reel, 'like'));
    click('save', () => void this.saveOnFacebook());
    for (const action of ['comments', 'share', 'more']) click(action, () => void this.openFacebookAction(action));
    click('cc', () => this.setCaptions());
    click('caption-more', () => {
      this.captionExpanded = !this.captionExpanded;
      this.captionWasExpanded ||= this.captionExpanded;
      if (this.captionExpanded && this.captionSource) this.captionSource.click();
      this.renderOverlay();
    });
    click('mute', () => {
      const muted = !this.video.muted && this.video.volume > 0;
      if (!muted && !this.video.volume) this.video.volume = this.volume = this.audibleVolume ?? 0.5;
      this.setMuted(muted);
    });
    click('rate', () => this.toggleMenu('rates', 'rate'));
    click('volume-button', () => this.toggleMenu('volume-popover', 'volume-button'));
    for (const rate of playbackRates) {
      const option = document.createElement('button');
      const value = document.createElement('span');
      value.textContent = formatPlaybackRate(rate);
      const selected = document.createElement('span');
      selected.className = 'rate-selected';
      selected.textContent = '✓';
      selected.setAttribute('aria-hidden', 'true');
      option.append(value, selected);
      option.dataset.rate = rate;
      this.on(option, 'click', () => {
        this.rate = rate;
        this.video.playbackRate = rate;
        this.closePopovers();
        this.get('rate').focus();
        this.reveal();
      });
      this.get('rates').append(option);
    }
    this.on(this.get('volume'), 'input', event => {
      if (this.video.volume > 0) this.audibleVolume = this.video.volume;
      this.volume = Number(event.target.value) / 100;
      this.video.volume = this.volume;
      if (!this.volume || this.video.muted || this.fallbackMuted) this.setMuted(!this.volume);
    });
    this.on(this.get('volume'), 'change', () => {
      // Facebook's slider updates its own preference as well as the media element.
      if (this.volume > 0) setReelVolume(this.reel, this.volume);
    });
    this.on(this.stage, 'pointerdown', event => {
      if (!event.target.closest('.popover-wrap')) this.closePopovers();
    });
    this.on(this.stage, 'pointermove', () => this.reveal());
    this.on(this.dock, 'pointerleave', () => this.reveal());
    this.on(this.stage, 'focusin', () => this.reveal());
    this.on(this.stage, 'focusout', () => queueMicrotask(() => this.reveal()));
    this.on(document, 'fullscreenchange', () => {
      if (document.fullscreenElement === this.documentRoot) this.browserFullscreen = true;
      else if (this.browserFullscreen && this.active) void this.leave();
      if (!document.fullscreenElement) this.browserFullscreen = false;
      this.applyZoom();
    });
    this.on(window, 'blur', () => {
      this.stopHold();
      if (this.rangeDrag) {
        this.loop = this.rangeDrag.original;
        this.renderLoop();
      }
      this.gesture = this.rangeDrag = this.pan = undefined;
      this.viewport.classList.remove('panning');
      this.reveal();
    });
    const onStorage = (changes, area) => {
      if (area !== 'local') return;
      if (Object.hasOwn(changes, themeKey)) this.setTheme(changes[themeKey].newValue);
      if (Object.hasOwn(changes, languageKey)) this.setLanguage(changes[languageKey].newValue);
      for (const key of playbackKeys) {
        if (Object.hasOwn(changes, key)) this.setPlayerSetting(key, changes[key].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    this.listeners.signal.addEventListener('abort', () => chrome.storage.onChanged.removeListener(onStorage), { once: true });
    this.connectGestures();
    this.connectKeys();
  }

  connectGestures() {
    for (const [id, amount] of [['back', -0.1], ['forward', 0.1]]) {
      const button = this.get(id);
      this.on(button, 'pointerdown', event => {
        if (event.button !== 0) return;
        button.setPointerCapture(event.pointerId);
        this.startHold(id, amount);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.on(button, event, () => { this.stopHold(); this.reveal(); });
      }
      this.on(button, 'click', event => { if (event.detail === 0) this.step(amount); });
    }
    const pointerTime = event => {
      const rect = this.scrubber.getBoundingClientRect();
      return clamp((event.clientX - rect.left) / rect.width, 0, 1) * this.duration;
    };
    this.on(this.timeline, 'input', event => {
      this.showTenths = false;
      this.seek(Number(event.target.value));
      if (!this.video.paused && !this.scrubbing) this.resumeInsideLoop();
    });
    this.on(this.timeline, 'pointerdown', () => { this.scrubbing = true; });
    this.on(window, 'pointerup', () => this.finishScrubbing(), { capture: true });
    this.on(window, 'pointercancel', () => this.finishScrubbing(), { capture: true });
    this.on(this.scrubber, 'pointerdown', event => {
      if (!event.shiftKey || event.button !== 0 || this.timeline.disabled || event.target.closest('.handle')) return;
      event.preventDefault();
      this.rangeDrag = { pointer: event.pointerId, anchor: pointerTime(event), original: this.loop };
      this.scrubber.setPointerCapture(event.pointerId);
    }, { capture: true });
    this.on(this.scrubber, 'pointermove', event => {
      if (!this.duration) return;
      const time = pointerTime(event);
      if (this.gesture?.pointer === event.pointerId) {
        if (event.buttons) this.moveHandle(this.gesture.edge, time);
        else this.finishHandleDrag(event.pointerId);
      }
      if (this.rangeDrag?.pointer === event.pointerId) {
        const start = Math.min(this.rangeDrag.anchor, time);
        const end = Math.max(this.rangeDrag.anchor, time);
        if (end - start >= 0.2) {
          this.loop = { start: tenth(start), end: Math.min(this.duration, tenth(end)) };
          this.renderLoop();
        }
      }
      const hover = this.ui.querySelector('.hover-time');
      hover.hidden = false;
      hover.style.left = `${time / this.duration * 100}%`;
      hover.textContent = timeText(time);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.on(this.scrubber, type, event => {
        if (this.rangeDrag?.pointer !== event.pointerId) return;
        const { original } = this.rangeDrag;
        this.rangeDrag = undefined;
        if (type !== 'pointerup') this.loop = original;
        else if (this.repeatEnabled && this.loop && this.loop !== original) {
          this.showTenths = false;
          this.seek(this.loop.start);
        }
        this.updateRepeat();
        this.reveal();
      });
    }
    this.on(this.scrubber, 'pointerleave', () => { this.ui.querySelector('.hover-time').hidden = true; });
    for (const edge of ['start', 'end']) {
      const handle = this.get(`loop-${edge}`);
      this.on(handle, 'pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.gesture = { edge, pointer: event.pointerId };
        handle.setPointerCapture(event.pointerId);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.on(handle, event, pointer => this.finishHandleDrag(pointer.pointerId));
      }
      this.on(handle, 'keydown', event => {
        if (!this.loop) return;
        const step = event.shiftKey ? 1 : 0.1;
        const adjustments = {
          ArrowLeft: this.loop[edge] - step, ArrowRight: this.loop[edge] + step,
          Home: 0, End: this.duration,
        };
        if (!Object.hasOwn(adjustments, event.key)) return;
        this.moveHandle(edge, adjustments[event.key]);
        event.preventDefault();
      });
    }
    this.on(window, 'pointerup', event => this.finishHandleDrag(event.pointerId), { capture: true });
    this.on(window, 'pointercancel', event => this.finishHandleDrag(event.pointerId), { capture: true });
    this.on(this.viewport, 'wheel', event => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      this.zoomAt(this.zoom * Math.exp(-clamp(event.deltaY, -300, 300) * 0.003), event.clientX, event.clientY);
    }, { passive: false });
    this.on(this.viewport, 'pointerdown', event => {
      if (event.button !== 0) return;
      this.pan = { x: event.clientX, y: event.clientY, startX: this.panX, startY: this.panY, moved: false };
      this.viewport.setPointerCapture(event.pointerId);
    });
    this.on(this.viewport, 'pointermove', event => {
      if (!this.pan || this.zoom <= 1) return;
      const x = event.clientX - this.pan.x;
      const y = event.clientY - this.pan.y;
      if (Math.hypot(x, y) < 4 && !this.pan.moved) return;
      this.pan.moved = true;
      this.viewport.classList.add('panning');
      this.panX = this.pan.startX + x;
      this.panY = this.pan.startY + y;
      this.applyZoom();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.on(this.viewport, event, () => {
        if (event === 'pointerup' && this.pan && !this.pan.moved) this.togglePlay();
        this.pan = undefined;
        this.viewport.classList.remove('panning');
        this.reveal();
      });
    }
  }

  finishScrubbing() {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    if (this.active && !this.video.paused) this.resumeInsideLoop();
  }

  finishHandleDrag(pointerId) {
    if (this.gesture?.pointer !== pointerId) return;
    this.gesture = undefined;
    if (this.active && !this.video.paused) this.resumeInsideLoop();
    this.reveal();
  }

  connectKeys() {
    const actions = {
      k: () => this.togglePlay(),
      m: () => this.get('mute').click(),
      h: () => this.get('overlay').click(),
      s: () => this.get('frame').click(),
      r: () => this.get('rate').click(),
      v: () => this.get('volume-button').click(),
      c: () => this.setCaptions(),
      f: () => void this.leave(),
      l: () => this.toggleRepeat(),
      pageup: () => this.navigate('previous'),
      pagedown: () => this.navigate('next'),
      arrowup: () => this.navigate('previous'),
      arrowdown: () => this.navigate('next'),
      '+': () => this.zoomAt(this.zoom * 1.25),
      '=': () => this.zoomAt(this.zoom * 1.25),
      '-': () => this.zoomAt(this.zoom / 1.25),
      '0': () => this.zoomAt(1),
    };
    this.on(document, 'keydown', event => {
      if (event.ctrlKey || event.metaKey || event.isComposing) return;
      const editable = event.composedPath().some(node => node instanceof Element &&
        node.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
      const focus = this.ui.activeElement;
      const key = event.key.toLowerCase();
      if (!this.active) {
        if (key === 'f' && !editable && !event.altKey && !event.shiftKey && !event.repeat &&
            !this.launch.hidden && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.enter();
        }
        return;
      }
      if (key === 'escape') {
        if (!this.get('rates').hidden || !this.get('volume-popover').hidden) {
          const trigger = this.get('rates').hidden ? 'volume-button' : 'rate';
          this.closePopovers();
          this.get(trigger).focus();
        } else {
          void this.leave();
        }
      } else if ((!editable || focus === this.timeline) && !event.altKey && this.loopStyle === 'marks' &&
          (key === '[' || key === ']')) {
        if (!event.repeat) this.setLoopMark(key === '[' ? 'start' : 'end');
      } else if (focus?.matches('input,[role="slider"]')) {
        return;
      } else if (key === 'l' && event.shiftKey && !event.altKey) {
        if (!event.repeat) this.clearLoop();
      } else if (event.altKey && this.zoom > 1 && Object.hasOwn(panKeys, event.key)) {
        const [x, y] = panKeys[event.key];
        this.panX += x * 40;
        this.panY += y * 40;
        this.applyZoom();
      } else if (!event.altKey && (key === 'arrowleft' || key === 'arrowright')) {
        const direction = key === 'arrowleft' ? -1 : 1;
        if (!event.repeat) {
          if (event.shiftKey) this.step(direction * 5);
          else this.startHold(key, direction * 0.1);
        }
      } else if (!event.altKey && key === ' ' && !focus?.matches('button,a')) {
        if (!event.repeat) this.togglePlay();
      } else if (!event.altKey && Object.hasOwn(actions, key)) {
        if (!event.repeat) actions[key]();
      } else {
        return;
      }
      this.reveal();
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
    this.on(window, 'keyup', event => {
      if (this.hold === event.key.toLowerCase()) {
        this.stopHold();
        this.reveal();
      }
    });
  }
}
