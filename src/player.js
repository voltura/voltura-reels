import markup from './player.html';
import css from './player.css';
import pageStyles from '../extension/facebook.css';
import themes from '../extension/themes.css';
import {
  defaultTheme,
  formatPlaybackRate,
  playbackRates,
  playerSetting,
  playerSettings,
  themeKey,
  validTheme,
} from '../extension/preferences.js';
import { languageKey, resolveLanguage, translator } from '../extension/languages.js';
import { paintIcon } from './icons.js';
import { renderCaption } from './caption.js';
import { clamp, panBounds, seekTarget, tenth, timeText } from './media.js';
import {
  isEnabled,
  nativeAction,
  reelControl,
  reelLiked,
  reelMetadata,
  reelMuteControl,
  setReelVolume,
  storyPhotoRegion,
} from './facebook.js';

const fullscreenAttribute = 'data-voltura-reel-fullscreen';
const videoAttribute = 'data-voltura-reel-video';
const photoAttribute = 'data-voltura-story-photo';
const pathAttribute = 'data-voltura-reel-path';
const progressAttribute = 'data-voltura-story-progress';
const progressPathAttribute = 'data-voltura-story-progress-path';
const storyActionAttribute = 'data-voltura-story-action';
const storyActionPathAttribute = 'data-voltura-story-action-path';
const storyActionsIdleAttribute = 'data-voltura-story-actions-idle';
const reactionAnimationAttribute = 'data-voltura-story-reaction-animation';
const reactionStillAttribute = 'data-voltura-story-reaction-still';
const reactionTooltipAttribute = 'data-voltura-story-reaction-tooltip';
const panKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const themeStyles = themes.replace(/:root(\[data-skin=[^\]]+\])/g, ':host($1)');
const playbackKeys = Object.keys(playerSettings);
const navigationActions = ['previous', 'next', 'previous-story', 'next-story'];

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
    this.storyFrame = this.ui.querySelector('.story-video-frame');
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
    this.progressPath = [];
    this.storyActionButtons = [];
    this.storyActionPath = [];
    this.storyReactionFrames = new Map();
    this.active = false;
    this.hiddenOverlay = false;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.connect();
    this.documentRoot.append(this.host);
    this.setLanguage();
    chrome.storage.local
      .get([themeKey, languageKey, ...playbackKeys])
      .then((values) => {
        this.setTheme(values[themeKey]);
        this.setLanguage(values[languageKey]);
        for (const key of playbackKeys) this.setPlayerSetting(key, values[key]);
      })
      .catch(() => {});
  }

  get(id) {
    return this.ui.getElementById(id);
  }
  get video() {
    return this.reel?.video;
  }
  get photo() {
    return this.reel?.photo;
  }
  get media() {
    return this.video ?? this.photo;
  }
  get mediaPaused() {
    return this.photo ? isEnabled(reelControl(this.reel, 'play')) : this.video?.paused;
  }
  get duration() {
    return Number.isFinite(this.video?.duration) ? this.video.duration : 0;
  }
  get position() {
    return this.requestedTime ?? this.video?.currentTime ?? 0;
  }

  on(target, type, handler, options) {
    target.addEventListener(type, handler, { ...options, signal: this.listeners.signal });
  }

  setTheme(theme) {
    this.host.dataset.skin = validTheme(theme);
  }

  setPlayerSetting(key, value) {
    const setting = playerSetting(key, value);
    if (key === 'dockWidth') this.dock.dataset.width = setting;
    if (key === 'controlsVisibility') {
      this.controlsVisibility = setting;
      this.layout.classList.toggle('controls-always', setting === 'always');
      this.reveal();
    }
    if (key === 'loopStyle' && setting !== this.loopStyle) {
      const focus = this.ui.activeElement;
      this.loopStyle = setting;
      this.gesture = undefined;
      if (this.loop && !this.hasLoop && setting === 'handles') this.loop = undefined;
      if (this.active) {
        this.renderLoop();
        if (focus?.closest('[hidden]'))
          this.get(setting === 'marks' ? 'mark-start' : 'select-range').focus();
      }
    }
  }

  setLanguage(preference) {
    this.host.lang = resolveLanguage(preference);
    this.translate = translator(this.host.lang);
    for (const element of this.ui.querySelectorAll('[aria-label]')) {
      const message = element.dataset.message ?? element.getAttribute('aria-label');
      if (element.matches('button')) this.label(element, message, element.dataset.tooltipMessage);
      else {
        element.dataset.message = message;
        element.setAttribute('aria-label', this.translate(message));
      }
    }
    for (const element of this.ui.querySelectorAll('[data-text]')) {
      element.textContent = this.translate(element.dataset.text);
    }
    if (this.active && this.photo) this.render();
    this.applyZoom();
  }

  setPlaybackLabels(kind) {
    const story = kind === 'story';
    this.stage.dataset.kind = kind;
    this.get('previous-story').hidden = !story;
    this.get('next-story').hidden = !story;
    paintIcon(this.get('previous'), story ? 'left' : 'previous');
    paintIcon(this.get('next'), story ? 'right' : 'next');
    paintIcon(this.get('back'), story ? 'seek-back' : 'left');
    paintIcon(this.get('forward'), story ? 'seek-forward' : 'right');
    for (const [button, reelLabel, storyLabel] of [
      [this.launch, 'Fullscreen reel', 'Fullscreen story'],
      [this.get('previous'), 'Previous reel', 'Previous card'],
      [this.get('next'), 'Next reel', 'Next card'],
    ]) {
      this.label(button, story ? storyLabel : reelLabel);
    }
    for (const [element, reelLabel, storyLabel] of [
      [this.stage, 'Reel playback', 'Story playback'],
      [this.ui.querySelector('.fixed-controls'), 'Navigate reels and seek', 'Story navigation and seeking'],
    ]) {
      element.dataset.message = story ? storyLabel : reelLabel;
      element.setAttribute('aria-label', this.translate(element.dataset.message));
    }
  }

  update(reel) {
    if (this.linkedClip && !reel.embedded) {
      if (reel.kind === 'story' && reel.key === this.linkedClip.story.key) {
        this.linkedClip.story = reel;
        this.setStoryProgress(reel.progress);
        return;
      }
      this.closeStoryVideo(false);
    }
    this.storyGate = undefined;
    clearTimeout(this.mediaWaitTimer);
    this.mediaWaitTimer = undefined;
    if (this.reel?.kind !== reel.kind) {
      if (this.active) void this.leave();
      this.setPlaybackLabels(reel.kind);
    }
    const samePath = this.reel?.key === reel.key;
    const reusableVideo = reel.kind === 'story' || /^\/reels?$/.test(reel.key);
    const media = reel.video ?? reel.photo;
    const sameFeedMedia =
      this.media === media &&
      (!this.reel.source || !reel.source || this.reel.source === reel.source);
    const sameReel = samePath && (!reusableVideo || sameFeedMedia);
    const changed = this.media !== media || !sameReel;
    if (changed) {
      this.unpinMedia();
      this.mediaListeners?.abort();
      if (!this.storyJump) this.clearNavigation();
      this.stopHold();
      this.reel = reel;
      this.requestedTime = undefined;
      this.showTenths = false;
      if (!sameReel) this.captionExpanded = this.captionWasExpanded = false;
      if (!sameReel || !this.commentsState) this.loop = undefined;
      if (!sameReel) this.repeatEnabled = false;
      this.gesture = undefined;
      this.rangeDrag = undefined;
      this.scrubbing = null;
      this.pan = undefined;
      this.viewport.classList.remove('panning');
      this.stage.classList.toggle('photo-story', Boolean(this.photo));
      const viewportLabel = this.photo
        ? 'Photo. Press Space to pause or resume the Story.'
        : 'Video. Press Space to play or pause.';
      this.viewport.dataset.message = viewportLabel;
      this.viewport.setAttribute('aria-label', this.translate(viewportLabel));
      this.closePopovers();
      this.zoom = 1;
      this.panX = this.panY = 0;
      if (this.video) this.bindVideo();
      if (this.active) {
        this.pinMedia();
        if (!this.ui.activeElement?.checkVisibility()) this.viewport.focus({ preventScroll: true });
      }
    } else {
      this.reel = { ...reel, source: reel.source || this.reel.source };
    }
    const pending = this.pendingStoryOpen;
    if (pending && (reel.kind !== 'story' || reel.key.split('/')[2] !== pending.bucket)) {
      void this.cancelStoryOpen();
    } else if (pending?.granted && document.fullscreenElement === this.documentRoot) {
      const previous = this.previousStoryCardButton(pending);
      if (previous === undefined) return;
      if (previous) {
        previous.click();
        this.schedule();
        return;
      }
      this.clearPendingStoryOpen();
      this.startPlayback();
      return;
    }
    this.launch.hidden = this.active || Boolean(this.pendingStoryOpen);
    if (this.active) {
      this.restorePauseAfterNavigation();
      this.setStoryProgress(reel.progress);
      this.applyNativeRepeat();
      this.render();
      this.applyZoom();
      this.continueStoryJump();
    }
  }

  showStoryGate(gate) {
    this.storyGate = gate;
    if (this.active) void this.leave();
    if (this.pendingStoryOpen) return;
    this.setPlaybackLabels('story');
    this.launch.hidden = false;
  }

  waitForPlayback() {
    this.storyGate = undefined;
    if (!this.active) {
      this.launch.hidden = true;
      return;
    }
    if (this.reel.kind !== 'story' || this.mediaWaitTimer !== undefined) return;
    // The Story viewer can remove the previous slide before the next image loads.
    this.mediaWaitTimer = setTimeout(() => {
      void this.leave();
      this.launch.hidden = true;
      this.schedule();
    }, 1800);
  }

  bindVideo() {
    this.mediaListeners = new AbortController();
    const { signal } = this.mediaListeners;
    const video = this.video;
    for (const event of [
      'loadedmetadata',
      'durationchange',
      'loadeddata',
      'play',
      'pause',
      'volumechange',
      'ratechange',
      'progress',
    ]) {
      video.addEventListener(
        event,
        () => {
          if (event === 'loadedmetadata' && this.active) this.applyMediaPreferences();
          if (!this.active) return;
          if (event === 'play' || event === 'pause' || event === 'volumechange')
            this.applyAudioPreference();
          if (event === 'play') {
            this.showTenths = false;
            this.restorePauseAfterNavigation();
          }
          this.render();
          if (event === 'play' || event === 'pause') this.reveal();
          if (event === 'loadedmetadata') this.applyZoom();
        },
        { signal },
      );
    }
    video.addEventListener(
      'seeked',
      () => {
        if (!video.seeking) this.requestedTime = undefined;
        if (this.active) {
          this.enforceLoop();
          this.render();
        }
      },
      { signal },
    );
    video.addEventListener(
      'emptied',
      () => {
        this.requestedTime = undefined;
        this.scrubbing = null;
        this.gesture = this.rangeDrag = this.pan = undefined;
        this.stopHold();
        this.viewport.classList.remove('panning');
        this.reveal();
      },
      { signal },
    );
    video.addEventListener('timeupdate', () => this.enforceLoop(), { signal });
    video.addEventListener(
      'ended',
      () => {
        if (!this.active) return;
        if (this.repeatEnabled) {
          if (this.hasLoop && !this.restartLoop()) return;
          if (!this.hasLoop) this.seek(0);
          void video.play().catch(() => {});
        } else {
          this.render();
          this.reveal();
        }
      },
      { signal },
    );
    video.textTracks.addEventListener(
      'addtrack',
      () => {
        if (this.active) this.render();
      },
      { signal },
    );
    video.textTracks.addEventListener(
      'removetrack',
      () => {
        if (this.active) this.render();
      },
      { signal },
    );
  }

  applyMediaPreferences() {
    const video = this.video;
    if (this.rate !== undefined) video.playbackRate = this.rate;
    if (this.volume !== undefined) video.volume = this.volume;
    this.applyAudioPreference();
  }

  applyAudioPreference() {
    if (this.reel.embedded && this.fallbackMuted === false && this.video.volume === 0 && this.volume !== 0) {
      this.video.volume = this.volume ?? this.audibleVolume ?? 0.5;
    }
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

  pinMedia() {
    if (!this.media?.isConnected) return;
    for (
      let element = this.media.parentElement;
      element && element !== this.documentRoot;
      element = element.parentElement
    ) {
      element.setAttribute(pathAttribute, '');
      this.path.push(element);
    }
    this.media.setAttribute(this.photo ? photoAttribute : videoAttribute, '');
    if (this.video) {
      this.nativeRepeat = this.video.loop;
      this.applyNativeRepeat();
      this.applyMediaPreferences();
    }
    this.applyZoom();
  }

  unpinMedia() {
    for (const element of this.path) element.removeAttribute(pathAttribute);
    this.path = [];
    if (!this.media) return;
    if (this.nativeRepeat !== undefined) {
      this.video.loop = this.nativeRepeat;
      this.nativeRepeat = undefined;
    }
    this.media.removeAttribute(this.photo ? photoAttribute : videoAttribute);
    for (const name of ['--voltura-zoom', '--voltura-pan-x', '--voltura-pan-y'])
      this.media.style.removeProperty(name);
  }

  setStoryProgress(progress) {
    if (this.progress !== progress) {
      this.progress?.removeAttribute(progressAttribute);
      this.progress?.style.removeProperty('--voltura-story-progress-width');
      for (const element of this.progressPath) element.removeAttribute(progressPathAttribute);
      this.progressPath = [];
      this.progress = progress;
      if (progress) {
        for (let element = progress.parentElement; element && element !== this.documentRoot; element = element.parentElement) {
          element.setAttribute(progressPathAttribute, '');
          this.progressPath.push(element);
        }
        progress.setAttribute(progressAttribute, '');
      }
    }
    this.sizeStoryProgress();
  }

  sizeStoryProgress() {
    if (!this.progress || !this.media) return;
    const width = this.photo?.naturalWidth ?? this.video.videoWidth;
    const height = this.photo?.naturalHeight ?? this.video.videoHeight;
    if (!width || !height) return;
    const progressWidth = Math.max(1, Math.min(innerWidth, (innerHeight * width) / height) - 24);
    this.progress.style.setProperty('--voltura-story-progress-width', `${progressWidth}px`);
  }

  canEnter() {
    const target = this.storyGate?.card ?? this.media;
    const key = this.storyGate?.key ?? this.reel?.key;
    return (
      !this.active &&
      !this.pendingStoryOpen &&
      !this.launch.hidden &&
      target?.isConnected &&
      key === location.pathname.replace(/\/$/, '') &&
      !document.fullscreenElement
    );
  }

  enter() {
    if (!this.canEnter()) return;
    if (this.storyGate) {
      this.openStoryFullscreen(this.storyGate);
      return;
    }
    const fullscreen = this.documentRoot.requestFullscreen({ navigationUI: 'hide' });
    this.startPlayback();
    fullscreen
      .then(() => {
        if (!this.active && document.fullscreenElement === this.documentRoot)
          void document.exitFullscreen();
      })
      .catch(() => {
        if (!this.active) return;
        void this.leave();
        this.announce('Fullscreen unavailable', this.ui.querySelector('.launch-notice'));
      });
  }

  openStoryFullscreen(gate) {
    const pending = { bucket: gate.key.split('/')[2], granted: false };
    this.pendingStoryOpen = pending;
    this.launch.hidden = true;
    this.ui.querySelector('.launch-notice').hidden = true;
    gate.card.click();
    // Request fullscreen in the original click or key event, before media loads.
    const fullscreen = this.documentRoot.requestFullscreen({ navigationUI: 'hide' });
    pending.timer = setTimeout(() => {
      void this.cancelStoryOpen();
      this.announce('Playback unavailable', this.ui.querySelector('.launch-notice'));
    }, 8000);
    fullscreen
      .then(() => {
        if (this.pendingStoryOpen === pending) {
          pending.granted = true;
          this.documentRoot.setAttribute(fullscreenAttribute, '');
          this.schedule();
        } else if (!this.active && !this.pendingStoryOpen && document.fullscreenElement === this.documentRoot) {
          void document.exitFullscreen().catch(() => {});
        }
      })
      .catch(() => {
        if (this.pendingStoryOpen !== pending) return;
        void this.cancelStoryOpen();
        this.announce('Fullscreen unavailable', this.ui.querySelector('.launch-notice'));
      });
  }

  clearPendingStoryOpen() {
    clearTimeout(this.pendingStoryOpen?.timer);
    this.pendingStoryOpen = undefined;
  }

  cancelStoryOpen() {
    this.clearPendingStoryOpen();
    this.documentRoot.removeAttribute(fullscreenAttribute);
    this.schedule();
    return document.fullscreenElement === this.documentRoot
      ? document.exitFullscreen().catch(() => {})
      : Promise.resolve();
  }

  startPlayback() {
    this.fallbackMuted = undefined;
    this.volume = undefined;
    this.requestedTime = undefined;
    this.active = true;
    this.documentRoot.setAttribute(fullscreenAttribute, '');
    this.launch.hidden = true;
    this.stage.hidden = false;
    this.ui.querySelector('.launch-notice').hidden = true;
    if (this.commentsState?.key === this.reel.key) {
      const saved = this.commentsState;
      this.zoom = saved.zoom;
      this.panX = saved.x;
      this.panY = saved.y;
    } else {
      this.zoom = 1;
      this.panX = this.panY = 0;
    }
    this.commentsState = undefined;
    this.pinMedia();
    this.setStoryProgress(this.reel.progress);
    this.render();
    this.reveal();
    this.viewport.focus({ preventScroll: true });
    this.frame = requestAnimationFrame(() => this.tick());
  }

  leave() {
    if (this.pendingStoryOpen) return this.cancelStoryOpen();
    if (!this.active) return Promise.resolve();
    if (this.linkedClip) this.closeStoryVideo(true);
    this.active = false;
    this.stopHold();
    this.clearNavigation();
    this.storyPauseNavigation = undefined;
    clearTimeout(this.revealTimer);
    clearTimeout(this.noticeTimer);
    clearTimeout(this.mediaWaitTimer);
    this.mediaWaitTimer = undefined;
    cancelAnimationFrame(this.frame);
    this.gesture = this.rangeDrag = this.pan = undefined;
    this.scrubbing = null;
    this.viewport.classList.remove('panning');
    this.stage.hidden = true;
    this.stage.querySelector('.osd').hidden = true;
    this.launch.hidden = false;
    this.closePopovers();
    this.unpinMedia();
    this.setStoryProgress(undefined);
    this.setStoryActions();
    this.documentRoot.removeAttribute(storyActionsIdleAttribute);
    this.documentRoot.removeAttribute(fullscreenAttribute);
    this.launch.focus({ preventScroll: true });
    return document.fullscreenElement === this.documentRoot
      ? document.exitFullscreen().catch(() => {})
      : Promise.resolve();
  }

  destroy() {
    void this.leave();
    this.listeners.abort();
    this.mediaListeners?.abort();
    this.host.remove();
  }

  announce(message, notice = this.stage.querySelector('.osd')) {
    clearTimeout(this.noticeTimer);
    notice.textContent = this.translate(message);
    notice.hidden = false;
    this.noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 2000);
  }

  reveal() {
    if (!this.active) return;
    clearTimeout(this.revealTimer);
    this.dock.classList.remove('faded');
    this.layout.classList.remove('controls-idle');
    this.documentRoot.removeAttribute(storyActionsIdleAttribute);
    if (this.controlsVisibility === 'always' && !this.hiddenOverlay) return;
    this.revealTimer = setTimeout(() => {
      const menuOpen = !this.get('rates').hidden || !this.get('volume-popover').hidden;
      const keyboardFocus =
        !this.stage.classList.contains('pointer-controls') &&
        ((this.ui.activeElement !== this.viewport && this.ui.activeElement?.matches(':focus-visible')) ||
          this.storyActionButtons.some((button) => button.matches(':focus-visible')));
      const hovering =
        matchMedia('(hover: hover)').matches &&
        (this.ui.querySelector(':is(#overlay, .utility-end, .social, .creator, .dock):hover') ||
          this.storyActionButtons.some((button) => button.matches(':hover')));
      if (
        hovering ||
        keyboardFocus ||
        menuOpen ||
        this.scrubbing ||
        this.gesture ||
        this.rangeDrag ||
        this.pan ||
        this.hold
      )
        return;
      this.layout.classList.add('controls-idle');
      if (this.controlsVisibility !== 'always') {
        this.dock.classList.add('faded');
        if (this.storyActionButtons.length) this.documentRoot.setAttribute(storyActionsIdleAttribute, '');
      }
    }, 1550);
  }

  tick() {
    if (!this.active) return;
    if (this.storyReactionRetry !== undefined && performance.now() >= this.storyReactionRetry) {
      this.updateStoryReactionFrames();
    }
    this.enforceLoop();
    if (this.video && !this.video.paused && !this.video.seeking) {
      this.renderTime();
    }
    this.frame = requestAnimationFrame(() => this.tick());
  }

  enforceLoop() {
    const video = this.video;
    const loop = this.loop;
    if (
      !this.active ||
      !video ||
      video.paused ||
      video.seeking ||
      !this.repeatEnabled ||
      !this.hasLoop ||
      this.gesture ||
      this.rangeDrag ||
      this.scrubbing
    )
      return;
    if (video.currentTime < loop.start - 0.025 || video.currentTime >= loop.end) this.restartLoop();
  }

  restartLoop() {
    const ranges = this.video.seekable;
    for (let index = 0; index < ranges.length; index++) {
      const start = Math.max(this.loop.start, ranges.start(index));
      if (start >= Math.min(this.loop.end, ranges.end(index))) continue;
      if (Math.abs(this.position - start) > 0.001) this.seek(start, 1);
      return true;
    }
    return false;
  }

  seek(time, direction = 0) {
    if (!this.video || !this.duration) return;
    const target = seekTarget(
      this.video.seekable,
      clamp(time, 0, Math.max(0, this.duration - 0.001)),
      direction,
    );
    if (target === null) return;
    // Scrubbing does not change whether repeat is enabled. Playback resumes
    // inside the selected range when the user finishes moving the playhead.
    this.requestedTime = target;
    this.video.currentTime = target;
    this.renderTime();
  }

  resumeInsideLoop() {
    if (
      this.repeatEnabled &&
      this.hasLoop &&
      (this.position < this.loop.start || this.position >= this.loop.end)
    ) {
      this.restartLoop();
    }
  }

  step(amount) {
    this.showTenths = this.video.paused && Math.abs(amount) < 5;
    const target = this.position + amount;
    if (this.repeatEnabled && this.hasLoop && (target < this.loop.start || target >= this.loop.end)) {
      if (amount > 0) this.restartLoop();
      else this.seek(Math.max(this.loop.start, this.loop.end - 0.1), -1);
    } else this.seek(target, Math.sign(amount));
  }

  togglePlay() {
    this.storyPauseNavigation = undefined;
    if (this.photo) {
      if (!nativeAction(this.reel, 'play')) nativeAction(this.reel, 'pause');
      this.schedule();
      return;
    }
    this.applyAudioPreference();
    const story = this.reel.kind === 'story' && !this.reel.embedded;
    if (!this.video.paused) {
      if (story) nativeAction(this.reel, 'pause');
      if (!this.video.paused) this.video.pause();
      return;
    }
    this.resumeInsideLoop();
    if (story) nativeAction(this.reel, 'play');
    if (this.video.paused) void this.video.play().catch(() => this.announce('Playback unavailable'));
  }

  playStoryVideo() {
    const url = this.reel.videoLink;
    if (!url || !this.photo?.isConnected || this.linkedClip) return;
    const muted = reelMuteControl(this.reel)?.muted;
    const resumeStory = !this.mediaPaused && nativeAction(this.reel, 'pause');
    const clip = {
      story: this.reel,
      resumeStory,
      muted,
      previousMuted: this.fallbackMuted,
      previousVolume: this.volume,
    };
    this.linkedClip = clip;
    this.setStoryActions();
    this.stage.classList.add('waiting-for-story-video');
    this.get('back-to-story').hidden = false;
    this.get('back-to-story').focus({ preventScroll: true });
    const embed = new URL('/plugins/video.php', location.origin);
    embed.searchParams.set('href', url);
    embed.searchParams.set('show_text', 'false');
    embed.searchParams.set('autoplay', 'true');
    this.storyFrame.src = embed.href;
    this.storyFrame.hidden = false;
  }

  connectStoryVideo() {
    const clip = this.linkedClip;
    const frame = this.storyFrame;
    const doc = frame.contentDocument;
    if (!clip || !doc || doc.URL === 'about:blank') return;
    clip.observer?.disconnect();
    const attach = () => {
      const video = doc.querySelector('video');
      if (!video || video === clip.video) return;
      if (!clip.video) {
        const style = new frame.contentWindow.CSSStyleSheet();
        style.replaceSync(pageStyles);
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, style];
        doc.documentElement.setAttribute(fullscreenAttribute, '');
        this.fallbackMuted = clip.muted;
        if (clip.muted === false && this.volume === 0) this.volume = undefined;
      }
      clip.video = video;
      this.stage.classList.remove('waiting-for-story-video');
      this.update({
        ...clip.story,
        photo: undefined,
        videoLink: undefined,
        video,
        wrapper: video.parentElement,
        source: video.currentSrc,
        embedded: true,
      });
      if (video.paused) void video.play().catch(() => {});
    };
    clip.observer = new MutationObserver(attach);
    clip.observer.observe(doc.documentElement, { subtree: true, childList: true });
    attach();
  }

  closeStoryVideo(restoreStory) {
    const clip = this.linkedClip;
    this.linkedClip = undefined;
    this.fallbackMuted = clip.previousMuted;
    this.volume = clip.previousVolume;
    clip.observer?.disconnect();
    this.storyFrame.hidden = true;
    this.storyFrame.removeAttribute('src');
    this.stage.classList.remove('waiting-for-story-video');
    this.get('back-to-story').hidden = true;
    if (restoreStory) {
      this.update(clip.story);
      if (clip.resumeStory) nativeAction(clip.story, 'play');
      this.viewport.focus({ preventScroll: true });
    }
  }

  clickedStoryVideo(x, y) {
    const image = this.photo;
    if (!this.reel.videoLink || !image?.naturalWidth || !image.naturalHeight) return false;
    const bounds = image.getBoundingClientRect();
    const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    return (
      Math.abs(x - (bounds.left + bounds.width / 2)) <= (image.naturalWidth * scale) / 2 &&
      Math.abs(y - (bounds.top + bounds.height / 2)) <= (image.naturalHeight * scale) / 2
    );
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

  get hasLoop() {
    return this.loop?.start != null && this.loop?.end != null;
  }

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
    const focusWasHidden =
      this.ui.activeElement === this.get('clear') || this.ui.activeElement?.classList.contains('handle');
    this.loop = undefined;
    this.updateRepeat();
    if (focusWasHidden) this.get(this.loopStyle === 'marks' ? 'mark-start' : 'select-range').focus();
  }

  clearNavigation() {
    clearTimeout(this.navigationTimer);
    this.navigating = false;
    this.storyJump = undefined;
  }

  navigate(action) {
    const current = this.linkedClip?.story ?? this.reel;
    const button = reelControl(current, action);
    if (this.navigating || !isEnabled(button)) return;
    const keepPaused = current.kind === 'story' && (this.linkedClip ? !this.linkedClip.resumeStory : this.mediaPaused);
    if (this.linkedClip) this.closeStoryVideo(true);
    const bucket = current.storyList?.bucket ?? current.key.split('/')[2];
    const media = current.video ?? current.photo;
    const acrossStories = action.endsWith('-story');
    if (acrossStories) this.storyJump = { fromBucket: bucket, media, source: current.source };
    this.storyPauseNavigation = keepPaused
      ? {
          key: current.key,
          bucket,
          media,
          source: current.source,
          acrossStories,
          expires: performance.now() + 3000,
        }
      : undefined;
    this.clickNavigation(button);
  }

  clickNavigation(button) {
    this.navigating = true;
    clearTimeout(this.navigationTimer);
    button.click();
    this.renderNavigation();
    this.navigationTimer = setTimeout(() => {
      this.clearNavigation();
      this.renderNavigation();
    }, 1800);
    this.schedule();
  }

  previousStoryCardButton(move) {
    const { source } = this.reel;
    // Wait for the media to change after clicking the previous card.
    if (this.media === move.media && source === move.source) return undefined;
    const previous = reelControl(this.reel, 'previous');
    if (!isEnabled(previous)) return null;
    move.media = this.media;
    move.source = source;
    return previous;
  }

  continueStoryJump() {
    const jump = this.storyJump;
    if (!jump) return;
    const { key, storyList } = this.reel;
    const bucket = storyList?.bucket ?? key.split('/')[2];
    if (jump.bucket && bucket !== jump.bucket) {
      this.clearNavigation();
      this.renderNavigation();
      return;
    }
    if (bucket === jump.fromBucket) return;

    const previous = this.previousStoryCardButton(jump);
    if (previous === undefined) return;
    if (!previous) {
      this.clearNavigation();
      this.renderNavigation();
      return;
    }
    jump.bucket = bucket;
    if (this.storyPauseNavigation) {
      this.storyPauseNavigation.expires = performance.now() + 3000;
      this.storyPauseNavigation.pauseButton = undefined;
    }
    this.clickNavigation(previous);
  }

  restorePauseAfterNavigation() {
    const move = this.storyPauseNavigation;
    if (!move) return;
    const { key, source, kind } = this.reel;
    const bucket = this.reel.storyList?.bucket ?? key.split('/')[2];
    if (performance.now() > move.expires || kind !== 'story' || (!move.acrossStories && bucket !== move.bucket)) {
      this.storyPauseNavigation = undefined;
      return;
    }
    if (key === move.key && bucket === move.bucket && this.media === move.media && source === move.source) return;

    const pause = reelControl(this.reel, 'pause');
    if (!isEnabled(pause)) {
      move.pauseButton = undefined;
    } else if (pause !== move.pauseButton) {
      move.pauseButton = pause;
      pause.click();
    }
    if (this.video && !this.video.paused) this.video.pause();
  }

  async openFacebookAction(action) {
    const reel = this.reel;
    if (!isEnabled(reelControl(reel, action))) return;
    if (action === 'comments') {
      this.commentsState = {
        key: reel.key,
        zoom: this.zoom,
        x: this.panX,
        y: this.panY,
      };
    }
    await this.leave();
    if (this.reel.key !== reel.key) return;
    nativeAction(this.reel, action);
  }

  async saveOnFacebook() {
    const reel = this.reel;
    if (this.saving || !isEnabled(reelControl(reel, 'more'))) return;
    this.saving = true;
    try {
      await this.leave();
      if (this.reel.key !== reel.key || this.video !== reel.video) return;
      const visibleItems = () =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).filter(
          (item) =>
            item.checkVisibility({ visibilityProperty: true }) &&
            !item.closest('[aria-hidden="true"],[inert]'),
        );
      const existing = new Set(visibleItems());
      if (!nativeAction(this.reel, 'more')) return;
      for (let tries = 0; tries < 16; tries++) {
        if (this.active || this.video !== reel.video || this.reel.key !== reel.key) return;
        const entry = visibleItems().find(
          (item) =>
            !existing.has(item) &&
            /^(save reel|save video|spara reel|spara video|spara videoklipp)$/i.test(
              item.textContent.trim(),
            ),
        );
        if (entry) {
          entry.click();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      this.announce('Check saved status in the Facebook menu', this.ui.querySelector('.launch-notice'));
    } finally {
      this.saving = false;
    }
  }

  canSaveImage() {
    if (!this.active || !this.media?.isConnected || this.reel.key !== location.pathname.replace(/\/$/, '')) {
      return false;
    }
    if (!this.mediaPaused) return false;
    if (this.photo) return Boolean(this.photo.currentSrc);
    const video = this.video;
    return !video.seeking && video.readyState >= 2 && video.videoWidth > 0 && !video.mediaKeys;
  }

  async capture() {
    if (!this.canSaveImage()) return;
    try {
      const id = this.photo ? await this.saveStoryPhoto() : await this.saveVideoFrame();
      if (!Number.isInteger(id)) throw new Error('Download did not start');

      let state = await chrome.runtime.sendMessage({ type: 'image-download-status', id });
      if (state === 'in_progress' && this.active) this.announce('Downloading…');
      while (state === 'in_progress' && this.active) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        state = await chrome.runtime.sendMessage({ type: 'image-download-status', id });
      }
      if (!this.active) return;
      if (state !== 'complete') throw new Error('Download did not complete');
      this.announce('Image saved');
    } catch {
      if (this.active) this.announce('Could not save image');
    }
  }

  async saveStoryPhoto() {
    const region = storyPhotoRegion(this.reel);
    if (!region) throw new Error('Linked image bounds unavailable');
    if (!region.crop) return chrome.runtime.sendMessage({ type: 'save-story-photo', source: region.source });

    const pixels = await chrome.runtime.sendMessage({ type: 'crop-story-photo', ...region });
    if (!pixels) throw new Error('Could not crop image');
    const blob = new Blob([Uint8Array.from(atob(pixels), (char) => char.charCodeAt(0))], { type: 'image/png' });
    return this.saveImageBlob(blob, { type: 'save-cropped-story-photo' });
  }

  async saveVideoFrame() {
    const video = this.video;
    const time = timeText(video.currentTime).replace(':', 'm');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Empty frame');
    return this.saveImageBlob(blob, { type: 'save-video-frame', time });
  }

  async saveImageBlob(blob, message) {
    const url = URL.createObjectURL(blob);
    try {
      return await chrome.runtime.sendMessage({ ...message, source: url });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  applyZoom() {
    const media = this.media;
    if (!media || !this.active) return;
    this.sizeStoryProgress();
    const [maxX, maxY] = panBounds(
      innerWidth,
      innerHeight,
      this.photo?.naturalWidth ?? this.video.videoWidth,
      this.photo?.naturalHeight ?? this.video.videoHeight,
      this.zoom,
    );
    this.panX = clamp(this.panX, -maxX, maxX);
    this.panY = clamp(this.panY, -maxY, maxY);
    media.style.setProperty('--voltura-zoom', this.zoom);
    media.style.setProperty('--voltura-pan-x', `${this.panX}px`);
    media.style.setProperty('--voltura-pan-y', `${this.panY}px`);
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
    for (const action of navigationActions) {
      const button = this.get(action);
      if (button.hidden) continue;
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
    if (this.timeline.getAttribute('aria-valuetext') !== elapsed)
      this.timeline.setAttribute('aria-valuetext', elapsed);
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
    const wholeVideo = this.reel.kind === 'story' ? 'Repeat whole story' : 'Repeat whole reel';
    this.label(repeat, complete ? 'Repeat selected segment' : wholeVideo);
    band.hidden = !complete;
    readout.hidden = this.get('clear').hidden = !exists;
    for (const edge of ['start', 'end']) {
      const handle = this.get(`loop-${edge}`);
      const marker = this.get(`marker-${edge}`);
      const button = this.get(`mark-${edge}`);
      const time = exists ? loop[edge] : undefined;
      marker.hidden = !marks || time === undefined;
      if (!marker.hidden) marker.style.left = `${(time / duration) * 100}%`;
      button.disabled = this.timeline.disabled;
      button.setAttribute('aria-pressed', String(time !== undefined));
      handle.hidden = marks || !complete;
      if (handle.hidden) continue;
      handle.style.left = `${(loop[edge] / duration) * 100}%`;
      handle.setAttribute('aria-valuenow', loop[edge]);
      handle.setAttribute('aria-valuemin', edge === 'start' ? 0 : Math.min(duration, loop.start + 0.2));
      handle.setAttribute('aria-valuemax', edge === 'end' ? duration : Math.max(0, loop.end - 0.2));
      handle.setAttribute('aria-valuetext', timeText(loop[edge]));
    }
    if (!exists) return;
    if (complete) {
      band.style.left = `${(loop.start / duration) * 100}%`;
      band.style.width = `${((loop.end - loop.start) / duration) * 100}%`;
    }
    band.classList.toggle('active', this.repeatEnabled);
    readout.classList.toggle('active', complete && this.repeatEnabled);
    const start = loop.start === undefined ? '–' : timeText(loop.start);
    const end = loop.end === undefined ? '–' : timeText(loop.end);
    const text = `${start}–${end}`;
    if (readout.textContent !== text) readout.textContent = text;
  }

  render() {
    this.renderNavigation();
    const expansion = clamp((this.duration - 60) / 240, 0, 1);
    this.dock.style.setProperty('--dock-expansion', expansion);
    const frame = this.get('frame');
    const linkedVideo = Boolean(this.reel.videoLink);
    this.get('story-video').hidden = !linkedVideo;
    const storyTimer = this.get('story-timer-text');
    storyTimer.hidden = !linkedVideo;
    const paused = this.mediaPaused;
    frame.hidden = !paused;
    frame.disabled = !this.canSaveImage();
    const play = this.get('play');
    if (this.photo) {
      const label = paused ? 'Resume Story' : 'Pause Story';
      paintIcon(play, paused ? 'play' : 'pause');
      this.label(play, label);
      if (linkedVideo) storyTimer.textContent = this.translate(label);
      play.disabled = !paused && !isEnabled(reelControl(this.reel, 'pause'));
      this.renderOverlay();
      return;
    }
    const video = this.video;
    play.disabled = false;
    this.renderTime();
    const seekable = Boolean(
      this.duration &&
      video.seekable.length &&
      video.seekable.end(video.seekable.length - 1) > video.seekable.start(0),
    );
    for (const element of [this.timeline, this.get('back'), this.get('forward')]) {
      if (element.disabled === seekable) element.disabled = !seekable;
    }
    this.renderLoop();
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
    const track = Array.from(video.textTracks).find(
      (item) => item.kind === 'captions' || item.kind === 'subtitles',
    );
    const cc = this.get('cc');
    cc.hidden = !track;
    cc.setAttribute('aria-pressed', String(track?.mode === 'showing'));
    this.renderOverlay();
  }

  renderOverlay() {
    const overlay = this.get('overlay');
    const story = this.reel.kind === 'story';
    this.setStoryActions(story && !this.linkedClip ? this.reel.storyActions : undefined);
    overlay.hidden = story;
    if (story) {
      this.get('social').hidden = true;
      this.get('creator').hidden = true;
      return;
    }
    paintIcon(overlay, this.hiddenOverlay ? 'eyeoff' : 'eye');
    this.label(overlay, this.hiddenOverlay ? 'Restore overlays' : 'Hide overlays');
    overlay.setAttribute('aria-pressed', String(this.hiddenOverlay));
    this.get('social').hidden = this.hiddenOverlay;
    const { owner, profile, photo, follow, followControl, caption, more } = reelMetadata(this.reel);
    this.captionSource = more;
    this.get('creator').hidden = this.hiddenOverlay || !(owner || caption.text);
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
    followState.disabled = !isEnabled(followControl);
    if (followState.textContent !== (follow ?? '')) followState.textContent = follow ?? '';
    const captionBox = this.get('caption');
    const captionKey = JSON.stringify(caption);
    if (this.captionKey !== captionKey) {
      this.captionKey = captionKey;
      renderCaption(captionBox, caption);
    }
    const expanded = Boolean(this.captionExpanded);
    this.get('creator').classList.toggle('expanded', expanded);
    const disclosure = this.get('caption-more');
    const canExpand = Boolean(more) || captionBox.scrollHeight > captionBox.clientHeight;
    disclosure.hidden = !caption.text || !(canExpand || expanded || this.captionWasExpanded);
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
      if (action === 'like') {
        const liked = reelLiked(native);
        button.setAttribute('aria-pressed', String(liked));
        this.label(button, 'Like reel', liked ? 'Unlike reel' : 'Like reel');
      }
    }
  }

  setStoryActions(actions) {
    const reactions = actions?.reactions.filter(isEnabled) ?? [];
    const share = isEnabled(actions?.share) ? actions.share : undefined;
    const buttons = share ? [share, ...reactions] : reactions;
    if (buttons.length === this.storyActionButtons.length &&
        buttons.every((button, index) => button === this.storyActionButtons[index])) {
      if (reactions.length && this.storyReactionRetry === undefined) this.updateStoryReactionFrames();
      return;
    }

    for (const button of this.storyActionButtons) {
      button.removeAttribute(storyActionAttribute);
      button.style.removeProperty('--voltura-story-action-offset');
      button.querySelector(`[${reactionTooltipAttribute}]`)?.removeAttribute(reactionTooltipAttribute);
    }
    for (const element of this.storyActionPath) element.removeAttribute(storyActionPathAttribute);

    const path = new Set();
    for (const [index, button] of buttons.entries()) {
      button.setAttribute(storyActionAttribute, button === share ? 'share' : 'reaction');
      button.style.setProperty('--voltura-story-action-offset', index - (buttons.length - 1) / 2);
      for (let element = button.parentElement; element && element !== this.documentRoot; element = element.parentElement) {
        path.add(element);
      }
    }
    for (const element of path) element.setAttribute(storyActionPathAttribute, '');
    this.storyActionButtons = buttons;
    this.storyActionPath = path;
    this.storyReactionButtons = reactions;
    this.updateStoryReactionFrames();
    this.documentRoot.toggleAttribute(storyActionsIdleAttribute, this.dock.classList.contains('faded'));
  }

  updateStoryReactionFrames() {
    this.storyReactionRetry = undefined;
    for (const [button, { animation, still }] of this.storyReactionFrames) {
      if (this.storyReactionButtons.includes(button) && button.contains(animation) && still.parentElement === button) continue;
      animation.removeAttribute(reactionAnimationAttribute);
      still.remove();
      this.storyReactionFrames.delete(button);
    }
    for (const button of this.storyReactionButtons) {
      const label = button.getAttribute('aria-label');
      const tooltip = Array.from(button.children).find((child) =>
        child.textContent.trim() === label && getComputedStyle(child).position === 'absolute',
      );
      tooltip?.setAttribute(reactionTooltipAttribute, '');
      if (this.storyReactionFrames.has(button)) continue;
      const animation = button.querySelector('canvas');
      if (!animation?.width || !animation.height) continue;
      const still = document.createElement('canvas');
      still.width = animation.width;
      still.height = animation.height;
      const context = still.getContext('2d');
      context.drawImage(animation, 0, 0);
      try {
        const { data } = context.getImageData(0, 0, still.width, still.height);
        if (!data.some((value, index) => index % 4 === 3 && value > 0)) {
          this.storyReactionRetry = performance.now() + 100;
          continue;
        }
      } catch (error) {
        // Canvas pixels can still be mirrored when their source prevents readback.
        if (error.name !== 'SecurityError') throw error;
      }
      animation.setAttribute(reactionAnimationAttribute, '');
      still.setAttribute(reactionStillAttribute, '');
      still.setAttribute('aria-hidden', 'true');
      button.append(still);
      this.storyReactionFrames.set(button, { animation, still });
    }
  }

  label(element, key, tooltipKey = key) {
    element.dataset.message = key;
    if (tooltipKey !== key) element.dataset.tooltipMessage = tooltipKey;
    else delete element.dataset.tooltipMessage;
    const translated = this.translate?.(key) ?? key;
    if (element.getAttribute('aria-label') !== translated)
      element.setAttribute('aria-label', translated);
    const tooltipText = tooltipKey === key ? translated : (this.translate?.(tooltipKey) ?? tooltipKey);
    element.dataset.tip = tooltipText;
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
    if (title.textContent !== tooltipText) title.textContent = tooltipText;
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
    const tracks = Array.from(this.video.textTracks).filter(
      (track) => track.kind === 'captions' || track.kind === 'subtitles',
    );
    if (!tracks.length) return;
    const current = tracks.find((track) => track.mode === 'showing');
    (current ?? tracks[0]).mode = current ? 'disabled' : 'showing';
    this.render();
  }

  connect() {
    for (const element of this.ui.querySelectorAll('[data-icon]'))
      paintIcon(element, element.dataset.icon);
    for (const element of this.ui.querySelectorAll('button[aria-label]'))
      this.label(element, element.getAttribute('aria-label'));
    const click = (id, action) =>
      this.on(this.get(id), 'click', () => {
        action();
        this.reveal();
      });
    this.on(this.launch, 'click', () => this.enter());
    click('exit', () => void this.leave());
    click('exit-dock', () => void this.leave());
    click('play', () => this.togglePlay());
    click('frame', () => void this.capture());
    click('story-video', () => this.playStoryVideo());
    click('back-to-story', () => this.closeStoryVideo(true));
    this.on(this.storyFrame, 'load', () => this.connectStoryVideo());
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
    for (const action of navigationActions) click(action, () => this.navigate(action));
    click('like', () => nativeAction(this.reel, 'like'));
    click('creator-follow', () => {
      const { followControl } = reelMetadata(this.reel);
      if (isEnabled(followControl)) followControl.click();
      this.renderOverlay();
    });
    click('save', () => void this.saveOnFacebook());
    for (const action of ['comments', 'share', 'more'])
      click(action, () => void this.openFacebookAction(action));
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
    this.on(this.get('volume'), 'input', (event) => {
      if (this.video.volume > 0) this.audibleVolume = this.video.volume;
      this.volume = Number(event.target.value) / 100;
      this.video.volume = this.volume;
      if (!this.volume || this.video.muted || this.fallbackMuted) this.setMuted(!this.volume);
    });
    this.on(this.get('volume'), 'change', () => {
      // Facebook's slider updates its own preference as well as the media element.
      if (this.volume > 0) setReelVolume(this.reel, this.volume);
    });
    this.on(this.stage, 'pointerdown', (event) => {
      this.stage.classList.add('pointer-controls');
      if (!event.target.closest('.popover-wrap')) this.closePopovers();
    });
    this.on(this.stage, 'pointermove', () => {
      this.stage.classList.add('pointer-controls');
      this.reveal();
    });
    for (const controls of this.ui.querySelectorAll(
      '#overlay, .utility-end, .social, .creator, .dock',
    )) {
      this.on(controls, 'pointerleave', () => {
        if (!this.layout.classList.contains('controls-idle')) this.reveal();
      });
    }
    this.on(this.stage, 'focusin', () => this.reveal());
    this.on(this.stage, 'focusout', () => queueMicrotask(() => this.reveal()));
    for (const event of ['pointermove', 'focusin']) {
      this.on(document, event, ({ target }) => {
        if (target instanceof Element && target.closest(`[${storyActionAttribute}]`)) this.reveal();
      });
    }
    this.on(document, 'click', (event) => {
      if (!(event.target instanceof Element) ||
          !event.target.closest(`[${storyActionAttribute}="share"]`)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.openFacebookAction('share');
    }, { capture: true });
    this.on(document, 'fullscreenchange', () => {
      if (document.fullscreenElement === this.documentRoot) this.browserFullscreen = true;
      else if (this.browserFullscreen && (this.active || this.pendingStoryOpen)) void this.leave();
      if (!document.fullscreenElement) this.browserFullscreen = false;
      this.applyZoom();
    });
    this.on(window, 'blur', () => {
      this.stopHold();
      this.finishScrubbing();
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
    this.listeners.signal.addEventListener(
      'abort',
      () => chrome.storage.onChanged.removeListener(onStorage),
      { once: true },
    );
    this.connectGestures();
    this.connectKeys();
  }

  connectGestures() {
    for (const [id, amount] of [
      ['back', -0.1],
      ['forward', 0.1],
    ]) {
      const button = this.get(id);
      this.on(button, 'pointerdown', (event) => {
        if (event.button !== 0) return;
        button.setPointerCapture(event.pointerId);
        this.startHold(id, amount);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.on(button, event, () => {
          this.stopHold();
          this.reveal();
        });
      }
      this.on(button, 'click', (event) => {
        if (event.detail === 0) this.step(amount);
      });
    }
    const pointerTime = (event) => {
      const rect = this.scrubber.getBoundingClientRect();
      return clamp((event.clientX - rect.left) / rect.width, 0, 1) * this.duration;
    };
    this.on(this.timeline, 'input', (event) => {
      this.showTenths = false;
      this.seek(Number(event.target.value));
      if (!this.video.paused && this.scrubbing == null) this.resumeInsideLoop();
    });
    this.on(this.timeline, 'pointerdown', (event) => {
      if (event.button === 0) this.scrubbing = event.pointerId;
    });
    for (const type of ['pointerup', 'pointercancel']) {
      this.on(window, type, (event) => this.finishScrubbing(event.pointerId), { capture: true });
    }
    this.on(
      this.scrubber,
      'pointerdown',
      (event) => {
        if (
          !event.shiftKey ||
          event.button !== 0 ||
          this.timeline.disabled ||
          event.target.closest('.handle')
        )
          return;
        event.preventDefault();
        this.rangeDrag = { pointer: event.pointerId, anchor: pointerTime(event), original: this.loop };
        this.scrubber.setPointerCapture(event.pointerId);
      },
      { capture: true },
    );
    this.on(this.scrubber, 'pointermove', (event) => {
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
      hover.style.left = `${(time / this.duration) * 100}%`;
      hover.textContent = timeText(time);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.on(this.scrubber, type, (event) => {
        if (this.rangeDrag?.pointer !== event.pointerId) return;
        const { original } = this.rangeDrag;
        this.rangeDrag = undefined;
        if (type !== 'pointerup') this.loop = original;
        else if (this.repeatEnabled && this.loop && this.loop !== original) {
          this.showTenths = false;
          this.restartLoop();
        }
        this.updateRepeat();
        this.reveal();
      });
    }
    this.on(this.scrubber, 'pointerleave', () => {
      this.ui.querySelector('.hover-time').hidden = true;
    });
    for (const edge of ['start', 'end']) {
      const handle = this.get(`loop-${edge}`);
      this.on(handle, 'pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.gesture = { edge, pointer: event.pointerId };
        handle.setPointerCapture(event.pointerId);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.on(handle, event, (pointer) => this.finishHandleDrag(pointer.pointerId));
      }
      this.on(handle, 'keydown', (event) => {
        if (!this.loop) return;
        const step = event.shiftKey ? 1 : 0.1;
        const adjustments = {
          ArrowLeft: this.loop[edge] - step,
          ArrowRight: this.loop[edge] + step,
          Home: 0,
          End: this.duration,
        };
        if (!Object.hasOwn(adjustments, event.key)) return;
        this.moveHandle(edge, adjustments[event.key]);
        event.preventDefault();
      });
    }
    this.on(window, 'pointerup', (event) => this.finishHandleDrag(event.pointerId), { capture: true });
    this.on(window, 'pointercancel', (event) => this.finishHandleDrag(event.pointerId), {
      capture: true,
    });
    this.on(
      this.viewport,
      'wheel',
      (event) => {
        if (event.ctrlKey || !event.deltaY) return;
        event.preventDefault();
        this.zoomAt(
          this.zoom * Math.exp(-clamp(event.deltaY, -300, 300) * 0.003),
          event.clientX,
          event.clientY,
        );
      },
      { passive: false },
    );
    this.on(this.viewport, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pan = {
        x: event.clientX,
        y: event.clientY,
        startX: this.panX,
        startY: this.panY,
        moved: false,
      };
      this.viewport.setPointerCapture(event.pointerId);
    });
    this.on(this.viewport, 'pointermove', (event) => {
      if (!this.pan) return;
      const x = event.clientX - this.pan.x;
      const y = event.clientY - this.pan.y;
      if (Math.hypot(x, y) < 4 && !this.pan.moved) return;
      this.pan.moved = true;
      if (this.zoom <= 1) return;
      this.viewport.classList.add('panning');
      this.panX = this.pan.startX + x;
      this.panY = this.pan.startY + y;
      this.applyZoom();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.on(this.viewport, event, (input) => {
        if (event === 'pointerup' && this.pan && !this.pan.moved) {
          if (this.clickedStoryVideo(input.clientX, input.clientY)) void this.playStoryVideo();
          else this.togglePlay();
        }
        this.pan = undefined;
        this.viewport.classList.remove('panning');
        this.reveal();
      });
    }
  }

  finishScrubbing(pointerId = this.scrubbing) {
    if (this.scrubbing == null || pointerId !== this.scrubbing) return;
    this.scrubbing = null;
    if (this.active && !this.video.paused) this.resumeInsideLoop();
    this.reveal();
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
      h: () => {
        const overlay = this.get('overlay');
        if (!overlay.hidden) overlay.click();
      },
      r: () => this.get('rate').click(),
      v: () => this.get('volume-button').click(),
      c: () => this.setCaptions(),
      l: () => this.toggleRepeat(),
      pageup: () => this.navigate('previous'),
      pagedown: () => this.navigate('next'),
      arrowup: () => this.navigate('previous'),
      arrowdown: () => this.navigate('next'),
      '+': () => this.zoomAt(this.zoom * 1.25),
      '=': () => this.zoomAt(this.zoom * 1.25),
      '-': () => this.zoomAt(this.zoom / 1.25),
      0: () => this.zoomAt(1),
    };
    this.on(
      window,
      'keydown',
      (event) => {
        if (event.ctrlKey || event.metaKey || event.isComposing) return;
        if (this.active && event.key === 'Tab') {
          this.stage.classList.remove('pointer-controls');
          this.reveal();
          return;
        }
        const editable = event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches(
                'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"]',
              ),
          );
        const focus = this.ui.activeElement;
        const key = event.key.toLowerCase();
        if (this.active && (key === 'enter' || key === ' ') && event.target instanceof Element) {
          const action = event.target.closest(`[${storyActionAttribute}]`)?.getAttribute(storyActionAttribute);
          if (action === 'share') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) void this.openFacebookAction('share');
          }
          if (action) return;
        }
        if (key === 'f' && !event.altKey && !event.shiftKey) {
          if (editable && !(this.active && focus?.matches('input[type="range"]'))) return;
          if (!this.active) {
            if (!this.canEnter()) return;
            const dialogs = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]');
            const blocked = Array.from(dialogs).some(
              (dialog) =>
                !dialog.contains(this.storyGate?.card ?? this.media) &&
                dialog.checkVisibility({ visibilityProperty: true }),
            );
            if (blocked) return;
          }
          if (!event.repeat) {
            if (this.active) void this.leave();
            else this.enter();
          }
        } else if (!this.active) {
          return;
        } else if (key === 's' && !event.altKey && (!editable || focus === this.timeline)) {
          if (!event.repeat) void this.capture();
        } else if (key === 'escape') {
          if (!this.get('rates').hidden || !this.get('volume-popover').hidden) {
            const trigger = this.get('rates').hidden ? 'volume-button' : 'rate';
            this.closePopovers();
            this.get(trigger).focus();
          } else {
            void this.leave();
          }
        } else if (this.photo && ['[', ']', 'c', 'l', 'm', 'r', 'v'].includes(key)) {
          return;
        } else if (
          (!editable || focus === this.timeline) &&
          !event.altKey &&
          this.loopStyle === 'marks' &&
          (key === '[' || key === ']')
        ) {
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
            if (this.photo) this.navigate(direction < 0 ? 'previous' : 'next');
            else if (event.shiftKey) this.step(direction * 5);
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
      },
      { capture: true },
    );
    this.on(window, 'keyup', (event) => {
      if (this.hold === event.key.toLowerCase()) {
        this.stopHold();
        this.reveal();
      }
    });
  }
}
