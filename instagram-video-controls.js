// ==UserScript==
// @name         Instagram Video Controls - Enhanced State Management
// @namespace    http://tampermonkey.net/
// @version      4.0.1
// @description  Accessible video controls for Instagram: seeking, volume, speed and optional background playback.
// @match        https://www.instagram.com/*
// @license      MIT
// @run-at       document-idle
// @grant        none
// @downloadURL https://update.greasyfork.org/scripts/523801/Instagram%20Video%20Controls%20-%20Enhanced%20State%20Management.user.js
// @updateURL https://update.greasyfork.org/scripts/523801/Instagram%20Video%20Controls%20-%20Enhanced%20State%20Management.meta.js
// ==/UserScript==

(() => {
    'use strict';

    // Also makes OpenCLI reinjection safe during development.
    window.__IGVideoControls?.destroy();
    const VERSION = '4.0.1';
    const KEY = 'igVideoPreferences';
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const defaults = { volume: 1, speed: 1, isMuted: false, backgroundPlay: false };
    const instances = new Map();
    const lifetime = new AbortController();
    let preferences = { ...defaults };
    let layer, observer, resizeObserver, intersection, frame = 0, nextId = 0, destroyed = false;
    let backgroundTarget = null;
    let pointer = { x: -1, y: -1 };

    // Real tab visibility, since the page-facing document.hidden is spoofed while BG is on.
    const realHidden = (Object.getOwnPropertyDescriptor(document, 'hidden') || Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')).get;
    const realState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get;
    const isHidden = () => realHidden.call(document);

    function validate(value) {
        const p = value && typeof value === 'object' ? value : {};
        return {
            volume: Number.isFinite(p.volume) && p.volume >= 0 && p.volume <= 1 ? p.volume : 1,
            speed: speeds.includes(p.speed) ? p.speed : 1,
            isMuted: typeof p.isMuted === 'boolean' ? p.isMuted : false,
            backgroundPlay: typeof p.backgroundPlay === 'boolean' ? p.backgroundPlay : false
        };
    }

    try { preferences = validate(JSON.parse(localStorage.getItem(KEY))); } catch { /* Storage may be blocked. */ }

    function listen(target, type, handler, signal = lifetime.signal, options = {}) {
        target.addEventListener(type, handler, { ...options, signal });
    }

    function update(changes, source) {
        preferences = validate({ ...preferences, ...changes });
        try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Controls still work in memory. */ }
        for (const instance of instances.values()) instance.apply(instance === source);
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
        const n = Math.floor(seconds);
        return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
    }

    function button(label, text, action) {
        const node = document.createElement('button');
        node.type = 'button';
        node.textContent = text;
        node.title = label;
        node.setAttribute('aria-label', label);
        node.addEventListener('click', action);
        return node;
    }

    function setLabel(node, text) {
        node.title = text;
        node.setAttribute('aria-label', text);
    }

    function range(label, max) {
        const node = document.createElement('input');
        node.type = 'range';
        node.min = '0';
        node.max = String(max);
        node.step = '1';
        node.setAttribute('aria-label', label);
        return node;
    }

    class VideoControls {
        constructor(video) {
            this.video = video;
            this.abort = new AbortController();
            this.id = String(++nextId);
            this.active = false;
            this.dragging = false;
            this.lastVolume = preferences.volume || 1;
            this.intendedPlaying = !video.paused;
            this.userPaused = false;
            this.backgroundResumeAttempts = 0;
            this.backgroundResumeTime = 0;
            this.nativeSoundUntil = 0;
            this.nativeSoundKind = null;
            this.pauseDescriptor = undefined;
            this.pauseWrapper = null;
            this.hideTimer = 0;
            this.rect = video.getBoundingClientRect();
            // IntersectionObserver respects ancestor clipping (carousels, overflow:hidden); getBoundingClientRect doesn't.
            this.visible = !intersection;
            intersection?.observe(video);
            this.controls = document.createElement('section');
            this.controls.className = 'igvc-controls';
            this.controls.dataset.igvcId = this.id;
            this.controls.setAttribute('aria-label', 'Instagram video controls');
            this.controls.hidden = true;

            this.seek = range('Seek video', 1000);
            this.seek.className = 'igvc-seek';
            this.play = button('Play', '▶', () => this.togglePlay());
            this.mute = button('Unmute', '◖', () => {
                backgroundTarget = this;
                const muted = !video.muted && video.volume > 0;
                update({ isMuted: muted, volume: !muted && video.volume === 0 ? this.lastVolume : preferences.volume }, this);
            });
            this.volume = range('Volume', 100);
            this.volume.className = 'igvc-volume';
            this.time = document.createElement('span');
            this.time.className = 'igvc-time';
            this.speed = document.createElement('select');
            this.speed.className = 'igvc-speed';
            setLabel(this.speed, 'Playback speed');
            for (const value of speeds) {
                const option = document.createElement('option');
                option.value = String(value);
                option.textContent = `${value}×`;
                this.speed.append(option);
            }
            this.background = button('Continue this video in the background', 'BG', () => {
                backgroundTarget = this;
                this.backgroundResumeAttempts = 0;
                update({ backgroundPlay: !preferences.backgroundPlay }, this);
            });
            this.status = document.createElement('span');
            this.status.className = 'igvc-status';
            this.status.setAttribute('role', 'status');
            const row = document.createElement('div');
            row.className = 'igvc-row';
            row.append(this.play, this.mute, this.volume, this.time, this.speed, this.background);
            this.controls.append(this.seek, row, this.status);
            layer.append(this.controls);

            const on = (target, type, handler, options) => listen(target, type, handler, this.abort.signal, options);
            // The controls live outside Instagram's React tree. Only our own events are stopped.
            for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown', 'keyup']) {
                on(this.controls, type, event => event.stopPropagation());
            }
            on(this.controls, 'focusin', () => this.reveal());
            on(this.controls, 'focusout', () => this.reveal(300));
            on(this.controls, 'pointerenter', () => this.reveal());
            on(this.controls, 'pointerleave', () => this.reveal(300));
            on(this.volume, 'input', () => {
                const volume = Number(this.volume.value) / 100;
                if (volume > 0) this.lastVolume = volume;
                update({ volume, isMuted: volume === 0 }, this);
                this.reveal();
            });
            on(this.speed, 'change', () => update({ speed: Number(this.speed.value) }, this));
            on(this.seek, 'input', () => {
                if (!this.canSeek()) return;
                video.currentTime = video.duration * Number(this.seek.value) / 1000;
                this.render();
                this.reveal();
            });
            on(this.seek, 'pointerdown', () => {
                if (video.paused) this.userPaused = true;
                this.dragging = true;
                this.reveal();
            });
            on(this.seek, 'keydown', event => {
                if (video.paused && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) this.userPaused = true;
            });
            const release = () => { this.dragging = false; this.reveal(); this.render(); };
            on(document, 'pointerup', () => { if (this.dragging) release(); }, { capture: true });
            on(document, 'pointercancel', () => { if (this.dragging) release(); }, { capture: true });
            on(this.seek, 'change', release);
            on(this.seek, 'blur', release);
            for (const type of ['timeupdate', 'durationchange', 'seeked']) {
                on(video, type, () => {
                    // A later loop gets its own recovery budget once playback
                    // has actually advanced; rapid failed restarts stay bounded.
                    if (type === 'timeupdate' && this.backgroundResumeAttempts && !video.paused &&
                        video.currentTime > this.backgroundResumeTime + 0.5) this.backgroundResumeAttempts = 0;
                    this.render();
                });
            }
            for (const type of ['volumechange', 'ratechange']) on(video, type, () => this.reconcile());
            on(video, 'loadedmetadata', () => this.apply());
            on(video, 'emptied', () => { this.userPaused = false; this.apply(); });
            on(video, 'play', () => {
                if (this.userPaused) {
                    this.intendedPlaying = false;
                    (this.pauseWrapper ? this.originalPause : video.pause).call(video);
                    this.render();
                    return;
                }
                this.intendedPlaying = true;
                if (!isHidden()) this.backgroundResumeAttempts = 0;
                if (!isHidden() && this.inViewport()) backgroundTarget = this;
                this.status.textContent = '';
                this.apply();
            });
            on(video, 'pause', () => {
                if (isHidden() && preferences.backgroundPlay && backgroundTarget === this &&
                    this.intendedPlaying && !this.userPaused && !video.ended && video.isConnected && this.backgroundResumeAttempts < 2) {
                    // Instagram also pauses through a cached native method, bypassing video.pause.
                    this.resumeBackground();
                } else this.intendedPlaying = false;
                this.render();
                this.visibility();
            });
            on(video, 'ended', () => {
                this.intendedPlaying = false;
                this.render();
            });
            if (!video.paused && this.inViewport()) backgroundTarget = this;
            this.apply();
            resizeObserver?.observe(video);
        }

        canSeek() { return Number.isFinite(this.video.duration) && this.video.duration > 0; }

        inViewport() {
            const r = this.rect;
            return r.width >= 160 && r.height >= 90 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        }

        apply(allowUnmute = false) {
            const video = this.video;
            if (!video.paused) this.rect = video.getBoundingClientRect();
            video.volume = preferences.volume;
            video.playbackRate = preferences.speed;
            // Leave Instagram's initial mute alone. Never unmute preloaded, paused videos.
            if (preferences.isMuted === true || preferences.volume === 0) video.muted = true;
            else if (preferences.isMuted === false && (allowUnmute || (!video.paused && navigator.userActivation?.hasBeenActive &&
                (isHidden() ? backgroundTarget === this && preferences.backgroundPlay : this.inViewport())))) video.muted = false;
            if (preferences.volume > 0) this.lastVolume = preferences.volume;
            this.configureBackground();
            this.render();
        }

        reconcile() {
            const video = this.video;
            this.rect = video.getBoundingClientRect();
            if (this.nativeSoundKind === 'volume' && Date.now() < this.nativeSoundUntil) {
                // A trusted interaction with Instagram's sound controls is a new
                // user choice, rather than an automatic player-state reset.
                const changes = { isMuted: video.muted || video.volume === 0 };
                changes.volume = video.volume;
                if (preferences.isMuted !== changes.isMuted || ('volume' in changes && preferences.volume !== changes.volume)) update(changes, this);
                else this.render();
                return;
            }
            // Instagram reapplies its own mute/volume after starting the next reel.
            // Correct only the playing video; leave preloaded videos and initial mute alone.
            if (!video.paused && (isHidden() ? backgroundTarget === this && preferences.backgroundPlay : this.inViewport())) {
                if (preferences.isMuted !== null) {
                    if (video.volume !== preferences.volume) video.volume = preferences.volume;
                    const muted = preferences.isMuted || preferences.volume === 0;
                    if (muted && !video.muted) video.muted = true;
                    else if (!muted && video.muted && navigator.userActivation?.hasBeenActive) video.muted = false;
                }
                if (video.playbackRate !== preferences.speed) video.playbackRate = preferences.speed;
            }
            this.render();
        }

        configureBackground() {
            const video = this.video;
            if (preferences.backgroundPlay && !this.pauseWrapper) {
                this.pauseDescriptor = Object.getOwnPropertyDescriptor(video, 'pause');
                this.originalPause = video.pause;
                this.pauseWrapper = (...args) => {
                    if (isHidden() && backgroundTarget === this && this.intendedPlaying && video.isConnected && !video.ended) return;
                    return this.originalPause.apply(video, args);
                };
                Object.defineProperty(video, 'pause', { configurable: true, writable: true, value: this.pauseWrapper });
            } else if (!preferences.backgroundPlay) this.restorePause();
        }

        restorePause() {
            if (!this.pauseWrapper) return;
            if (this.video.pause === this.pauseWrapper) {
                if (this.pauseDescriptor) Object.defineProperty(this.video, 'pause', this.pauseDescriptor);
                else delete this.video.pause;
            }
            this.pauseWrapper = null;
        }

        async resumeBackground() {
            this.backgroundResumeAttempts++;
            this.backgroundResumeTime = this.video.currentTime;
            try {
                await this.video.play();
            } catch {
                this.intendedPlaying = false;
                this.status.textContent = 'Background playback blocked. Return to the tab to resume.';
            }
        }

        async togglePlay() {
            backgroundTarget = this;
            if (this.video.paused) {
                this.userPaused = false;
                try {
                    await this.video.play();
                    this.status.textContent = '';
                } catch {
                    this.status.textContent = 'Playback blocked. Click the video and try again.';
                    this.reveal();
                }
            } else {
                this.userPaused = true;
                this.intendedPlaying = false;
                (this.pauseWrapper ? this.originalPause : this.video.pause).call(this.video);
            }
            this.render();
        }

        render() {
            const video = this.video;
            this.play.textContent = video.paused ? '▶' : 'Ⅱ';
            setLabel(this.play, video.paused ? 'Play' : 'Pause');
            const muted = video.muted || video.volume === 0;
            this.mute.textContent = muted ? '◖×' : '◖))';
            setLabel(this.mute, muted ? 'Unmute' : 'Mute');
            this.mute.setAttribute('aria-pressed', String(muted));
            this.volume.value = String(Math.round(muted ? 0 : video.volume * 100));
            this.volume.setAttribute('aria-valuetext', muted ? 'Muted' : `${Math.round(video.volume * 100)} percent`);
            this.speed.value = String(video.playbackRate);
            this.background.setAttribute('aria-pressed', String(preferences.backgroundPlay));
            this.time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
            this.seek.disabled = !this.canSeek();
            if (!this.dragging) this.seek.value = this.canSeek() ? String(Math.round(video.currentTime / video.duration * 1000)) : '0';
            this.seek.setAttribute('aria-valuetext', `${formatTime(video.currentTime)} of ${formatTime(video.duration)}`);
        }

        reveal(delay = 2000) {
            this.active = true;
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => { this.active = false; this.visibility(); }, delay);
            this.visibility();
        }

        visibility() {
            const focused = this.controls.contains(document.activeElement);
            this.controls.hidden = !this.available || !(this.active || this.video.paused || this.dragging || focused);
        }

        layout(dialog) {
            this.rect = this.video.getBoundingClientRect();
            if (!this.inViewport()) this.userPaused = false;
            const r = this.rect;
            const style = getComputedStyle(this.video);
            const d = dialog?.getBoundingClientRect();
            const blockedByDialog = dialog && !dialog.contains(this.video) &&
                (dialog.getAttribute('aria-modal') === 'true' || (d.left < r.right && d.right > r.left && d.top < r.bottom && d.bottom > r.top));
            this.available = this.visible && this.inViewport() && style.visibility !== 'hidden' && style.display !== 'none' &&
                !blockedByDialog && (!document.fullscreenElement || document.fullscreenElement.contains(this.video));
            const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
            const bottom = Math.min(innerHeight, r.bottom);
            if (right - left < 160 || bottom - Math.max(0, r.top) < 90) this.available = false;
            this.controls.style.left = `${left}px`;
            this.controls.style.top = `${bottom}px`;
            this.controls.style.width = `${Math.max(0, right - left)}px`;
            this.controls.classList.toggle('igvc-compact', right - left < 360);
            this.visibility();
        }

        destroy() {
            clearTimeout(this.hideTimer);
            this.abort.abort();
            this.restorePause();
            resizeObserver?.unobserve(this.video);
            intersection?.unobserve(this.video);
            this.controls.remove();
            if (backgroundTarget === this) backgroundTarget = null;
        }
    }

    function schedule() {
        if (!frame && !destroyed) frame = requestAnimationFrame(scan);
    }

    function scan() {
        frame = 0;
        if (destroyed) return;
        const host = document.fullscreenElement && document.fullscreenElement.tagName !== 'VIDEO' ? document.fullscreenElement : document.body;
        if (layer.parentNode !== host) host.append(layer);
        for (const [video, instance] of instances) {
            if (!video.isConnected) { instance.destroy(); instances.delete(video); }
        }
        for (const video of document.querySelectorAll('video')) {
            if (!instances.has(video)) instances.set(video, new VideoControls(video));
        }
        const dialog = [...document.querySelectorAll('[role="dialog"],dialog[open]')].reverse().find(node => {
            const r = node.getBoundingClientRect();
            const s = getComputedStyle(node);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        });
        for (const instance of instances.values()) instance.layout(dialog);
    }

    function start() {
        if (destroyed) return;
        layer = document.createElement('div');
        layer.id = 'igvc-layer';
        const styles = document.createElement('style');
        styles.textContent = `
            #igvc-layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
            #igvc-layer .igvc-controls { position: fixed; transform: translateY(-100%); box-sizing: border-box;
                margin: 0; padding: 14px 10px 6px; border: 0; color: white; background: linear-gradient(transparent, rgba(8,8,10,.94));
                font: 13px/1.4 Arial,sans-serif; pointer-events: auto; }
            #igvc-layer .igvc-controls[hidden] { display: none !important; }
            #igvc-layer .igvc-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
            #igvc-layer button, #igvc-layer select { appearance: auto; box-sizing: border-box; min-height: 32px; min-width: 32px;
                padding: 4px 6px; margin: 0; border: 0; border-radius: 5px; background: #202024; color: white;
                font: inherit; cursor: pointer; flex: 0 0 auto; }
            #igvc-layer button:hover, #igvc-layer button[aria-pressed="true"] { background: #71305b; }
            #igvc-layer :focus-visible { outline: 2px solid #ff7ac6; outline-offset: 2px; }
            #igvc-layer input[type="range"] { display: block; appearance: auto; box-sizing: border-box; min-width: 0;
                padding: 0; margin: 0; height: 22px; accent-color: #e653a1; cursor: pointer; touch-action: none; }
            #igvc-layer .igvc-seek { width: 100%; }
            #igvc-layer .igvc-volume { width: 65px; flex: 0 1 65px; }
            #igvc-layer .igvc-time { flex: 1 1 auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
            #igvc-layer .igvc-status { display: block; font-size: 12px; }
            #igvc-layer .igvc-status:empty { display: none; }
            #igvc-layer .igvc-compact { padding-inline: 4px; }
            #igvc-layer .igvc-compact .igvc-row { gap: 2px; flex-wrap: wrap; }
            #igvc-layer .igvc-compact .igvc-volume { width: 32px; flex-basis: 32px; }
            #igvc-layer .igvc-compact .igvc-time { font-size: 10px; }
            #igvc-layer .igvc-compact button { width: 28px; min-width: 28px; padding-inline: 2px; }
            #igvc-layer .igvc-compact select { width: 56px; min-width: 56px; padding-inline: 2px; }
        `;
        layer.append(styles);
        document.body.append(layer);
        if (typeof ResizeObserver === 'function') resizeObserver = new ResizeObserver(schedule);
        if (typeof IntersectionObserver === 'function') {
            intersection = new IntersectionObserver(entries => {
                for (const e of entries) {
                    const instance = instances.get(e.target);
                    if (instance) instance.visible = e.intersectionRatio >= 0.5;
                }
                schedule();
            }, { threshold: [0, 0.5, 1] });
        }
        observer = new MutationObserver(records => {
            if (records.some(record => !layer.contains(record.target))) schedule();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden', 'open', 'aria-modal'] });
        listen(document, 'scroll', schedule, lifetime.signal, { capture: true, passive: true });
        listen(window, 'resize', schedule, lifetime.signal, { passive: true });
        listen(document, 'fullscreenchange', schedule);
        const releaseNativePause = event => {
            if (!event.isTrusted || layer.contains(event.target)) return;
            if (event.type === 'keydown' && (![' ', 'k', 'K', 'Enter'].includes(event.key) || event.target.closest('input,textarea,[contenteditable="true"]'))) return;
            for (const instance of instances.values()) {
                const r = instance.rect;
                if (instance.available && (event.type === 'keydown' || (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom))) instance.userPaused = false;
            }
        };
        // Browsers refuse unmuted playback before the first click/key; unmute playing videos as soon as it happens.
        const unmuteOnActivation = () => setTimeout(() => { for (const i of instances.values()) i.apply(); });
        listen(document, 'pointerdown', unmuteOnActivation, lifetime.signal, { capture: true, passive: true, once: true });
        listen(document, 'keydown', unmuteOnActivation, lifetime.signal, { capture: true, passive: true, once: true });
        listen(document, 'pointerdown', releaseNativePause, lifetime.signal, { capture: true, passive: true });
        listen(document, 'keydown', releaseNativePause, lifetime.signal, { capture: true });
        const nativeSoundAction = event => {
            if (!event.isTrusted || layer.contains(event.target)) return;
            const control = event.target.closest('button,[role="button"],[role="slider"],input[type="range"]');
            if (!control) return;
            const ownIcon = [...control.querySelectorAll('svg[aria-label]')].find(icon => icon.closest('button,[role="button"],[role="slider"],input[type="range"]') === control);
            const label = `${control.getAttribute('aria-label') || ''} ${ownIcon?.getAttribute('aria-label') || ''}`;
            if (!/audio|sound|mute|volume/i.test(label)) return;
            if (event.type === 'keydown' && ![' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const rect = control.getBoundingClientRect();
            for (const instance of instances.values()) {
                const r = instance.video.getBoundingClientRect();
                const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
                if (!instance.available || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
                // Instagram's role=button handles Enter directly without a click.
                // Observe its resulting media state just like a native slider.
                instance.nativeSoundKind = event.type === 'keydown' || control.matches('[role="slider"],input[type="range"]') ? 'volume' : 'mute';
                if (instance.nativeSoundKind === 'mute') {
                    if (event.type !== 'click') continue;
                    // Use the native button's advertised action; its volume can
                    // briefly become zero during either side of the toggle.
                    const muted = /is muted|unmute|turn on|enable sound/i.test(label) ? false :
                        /is playing|mute|turn off|disable sound/i.test(label) ? true : !instance.video.muted;
                    instance.nativeSoundUntil = 0;
                    update({ isMuted: muted, volume: preferences.volume || instance.lastVolume || 1 }, instance);
                    continue;
                }
                instance.nativeSoundUntil = Date.now() + 800;
                // Some native toggles set the same media value as before, so no
                // volumechange event fires. Read their final state after React.
                queueMicrotask(() => { if (!destroyed && instance.video.isConnected) instance.reconcile(); });
            }
        };
        for (const type of ['pointerdown', 'click', 'keydown', 'input']) listen(document, type, nativeSoundAction, lifetime.signal, { capture: true, passive: type === 'pointerdown' });
        listen(document, 'pointermove', event => {
            // Mouse movement reveals controls even when Instagram puts a sibling overlay over the video.
            if (event.clientX === pointer.x && event.clientY === pointer.y) return;
            pointer = { x: event.clientX, y: event.clientY };
            for (const instance of instances.values()) {
                if (event.isTrusted && event.buttons && Date.now() < instance.nativeSoundUntil) instance.nativeSoundUntil = Date.now() + 800;
                const r = instance.rect;
                if (instance.available && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom) instance.reveal();
            }
        }, lifetime.signal, { passive: true });
        // Instagram pauses on visibilitychange; hide the change from it while BG is on.
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => preferences.backgroundPlay ? false : realHidden.call(document) });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => preferences.backgroundPlay ? 'visible' : realState.call(document) });
        listen(window, 'visibilitychange', () => {
            if (!isHidden()) {
                for (const instance of instances.values()) instance.backgroundResumeAttempts = 0;
            }
            if (isHidden() && preferences.backgroundPlay) {
                const playing = [...instances.values()].filter(i => !i.video.paused && i.available);
                if (playing.length) backgroundTarget = playing.find(i => i === backgroundTarget) || playing[0];
            }
        }, lifetime.signal, { capture: true });
        listen(window, 'visibilitychange', event => { if (preferences.backgroundPlay) event.stopImmediatePropagation(); }, lifetime.signal, { capture: true });
        listen(window, 'storage', event => {
            if (event.key !== KEY && event.key !== null) return;
            try { preferences = validate(JSON.parse(event.newValue)); } catch { return; }
            for (const instance of instances.values()) instance.apply();
        });
        scan();
    }

    window.__IGVideoControls = {
        version: VERSION,
        inspect() {
            return {
                version: VERSION, videos: instances.size,
                controls: [...instances.values()].map(i => ({ id: i.id, connected: i.video.isConnected,
                    videoIndex: [...document.querySelectorAll('video')].indexOf(i.video), available: Boolean(i.available), visible: !i.controls.hidden,
                    paused: i.video.paused, muted: i.video.muted, volume: i.video.volume, speed: i.video.playbackRate,
                    currentTime: i.video.currentTime, duration: Number.isFinite(i.video.duration) ? i.video.duration : null })),
                preferences: { ...preferences }
            };
        },
        destroy() {
            destroyed = true;
            lifetime.abort();
            observer?.disconnect();
            resizeObserver?.disconnect();
            intersection?.disconnect();
            delete document.hidden;
            delete document.visibilityState;
            cancelAnimationFrame(frame);
            for (const instance of instances.values()) instance.destroy();
            instances.clear();
            layer?.remove();
            delete window.__IGVideoControls;
        }
    };
    if (document.body) start();
    else listen(document, 'DOMContentLoaded', start, lifetime.signal, { once: true });
})();
