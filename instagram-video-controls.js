// ==UserScript==
// @name         Instagram Video Controls - Enhanced State Management
// @namespace    http://tampermonkey.net/
// @version      3.7
// @description  YouTube-style hover controls for Instagram with persistent state and invisible overlay bypass
// @match        https://www.instagram.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const nativeMutedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');

    const installMutedGuard = (video) => {
        if (!video || video.__igMutedGuardInstalled || !nativeMutedDescriptor) return;

        video.__igMutedGuardInstalled = true;
        video.__igOriginalSetAttribute = video.setAttribute;

        Object.defineProperty(video, 'muted', {
            configurable: true,
            get() {
                return nativeMutedDescriptor.get.call(this);
            },
            set(value) {
                const shouldMute = Boolean(value);
                if (!shouldMute || this.__igAllowMutedChange) {
                    nativeMutedDescriptor.set.call(this, shouldMute);
                }
                return nativeMutedDescriptor.get.call(this);
            }
        });

        video.setAttribute = function(name, value) {
            if (String(name).toLowerCase() === 'muted' && !this.__igAllowMutedChange) return;
            return this.__igOriginalSetAttribute.call(this, name, value);
        };
    };

    const setVideoMuted = (video, muted) => {
        if (!video) return;
        installMutedGuard(video);
        video.__igAllowMutedChange = true;
        try {
            video.muted = Boolean(muted);
            video.removeAttribute('muted');
        } finally {
            video.__igAllowMutedChange = false;
        }
    };

    // Immediate execution to handle any pre-existing videos
    const handleExistingVideos = () => {
        document.querySelectorAll('video').forEach(video => {
            installMutedGuard(video);
            setVideoMuted(video, false);
        });
    };

    handleExistingVideos();

    const preventMuting = () => {
        const originalCreateElement = document.createElement;
        document.createElement = function(tag) {
            const element = originalCreateElement.call(document, tag);
            if (tag.toLowerCase() === 'video') {
                installMutedGuard(element);
                setVideoMuted(element, false);
            }
            return element;
        };
    };

    const observeVideoElements = () => {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'VIDEO') {
                        installMutedGuard(node);
                        setVideoMuted(node, false);
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    };

    preventMuting();
    observeVideoElements();

    // UI Constants
    const UI = {
        colors: {
            primary: '#c13584',
            background: 'rgba(8,8,10,0.78)',
            backgroundStrong: 'rgba(8,8,10,0.92)',
            track: 'rgba(255,255,255,0.26)',
            text: '#ffffff',
            hover: 'rgba(255,255,255,0.1)'
        },
        sizes: {
            buttonSize: '32px',
            fontSize: { normal: '14px', large: '20px' },
            controlHeight: '48px',
            timelineHeight: '3px',
            timelineActiveHeight: '5px'
        },
        styles: {
            button: {
                background: 'none',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 0.16s ease, background-color 0.16s ease'
            },
            container: {
                display: 'flex',
                position: 'relative'
            }
        }
    };

    const Icons = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"></path></svg>',
        volumeHigh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4z"></path><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>',
        volumeLow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4z"></path><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>',
        volumeMuted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4z"></path><path d="m17 9 4 4m0-4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>'
    };

    // --- NEW: Shield Bypass System ---
    // Intercepts physical mouse clicks before Instagram's invisible React overlays swallow them.
    const ShieldBypass = {
        init() {
            ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                window.addEventListener(eventType, this.routeEvent.bind(this), true);
            });
            window.addEventListener('mousemove', this.routeVolumeHover.bind(this), true);
        },

        isPointInRect(e, rect, padding = 0) {
            return rect &&
                rect.width > 0 &&
                rect.height > 0 &&
                e.clientX >= rect.left - padding &&
                e.clientX <= rect.right + padding &&
                e.clientY >= rect.top - padding &&
                e.clientY <= rect.bottom + padding;
        },

        routeVolumeHover(e) {
            if (!e.isTrusted) return;

            document.querySelectorAll('.ig-video-volume-control').forEach(control => {
                if (control.dataset.igVolumeDragging === 'true') return;

                const button = control.querySelector('.ig-video-volume-button');
                const slider = control.querySelector('.ig-video-slider');
                if (!button || !slider) return;

                const buttonRect = button.getBoundingClientRect();
                const sliderRect = slider.getBoundingClientRect();
                const expandedRect = {
                    left: buttonRect.left,
                    right: buttonRect.right + 88,
                    top: buttonRect.top - 10,
                    bottom: buttonRect.bottom + 10,
                    width: buttonRect.width + 88,
                    height: buttonRect.height + 20
                };

                const shouldExpand =
                    this.isPointInRect(e, buttonRect, 6) ||
                    this.isPointInRect(e, sliderRect, 6) ||
                    this.isPointInRect(e, expandedRect, 0);

                control.classList.toggle('ig-video-volume-expanded', shouldExpand);
            });
        },

        routeEvent(e) {
            if (!e.isTrusted) return; // Prevent infinite loops from our own synthetic clicks

            const customControls = document.querySelectorAll(
                '.ig-video-control-button, .ig-video-speed-button, .ig-video-volume-button, .ig-video-slider, .ig-video-volume-slider-container, .ig-video-timeline-container, .ig-video-speed-option'
            );

            for (const control of customControls) {
                const rect = control.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                // Check if mouse is physically over our buttons
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {

                    // 1. Kill the event so Instagram doesn't pause the video
                    e.stopPropagation();
                    e.preventDefault();

                    // 2. Fire a ghost click directly onto our script's button
                    const clonedEvent = new MouseEvent(e.type, {
                        bubbles: false,
                        cancelable: true,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        view: window
                    });

                    control.dispatchEvent(clonedEvent);
                    return;
                }
            }
        }
    };

    // Video State Management
    const VideoState = {
        preferences: {
            volume: 1, speed: 1, backgroundPlay: false, isMuted: false, lastUpdate: Date.now()
        },
        activeControlInstances: new Set(),
        saveTimeout: null,
        lastKnownGoodState: null,

        initialize() {
            try {
                const saved = localStorage.getItem('igVideoPreferences');
                if (saved) {
                    const parsedPrefs = JSON.parse(saved);
                    this.preferences = {
                        volume: this.isValidVolume(parsedPrefs.volume) ? parsedPrefs.volume : this.preferences.volume,
                        speed: this.isValidSpeed(parsedPrefs.speed) ? parsedPrefs.speed : this.preferences.speed,
                        backgroundPlay: typeof parsedPrefs.backgroundPlay === 'boolean' ? parsedPrefs.backgroundPlay : this.preferences.backgroundPlay,
                        isMuted: typeof parsedPrefs.isMuted === 'boolean' ? parsedPrefs.isMuted : this.preferences.isMuted,
                        lastUpdate: Date.now()
                    };
                    this.lastKnownGoodState = { ...this.preferences };
                }

                this.setupLazyLoadDetection();
                this.setupIntersectionObserver();

                window.addEventListener('igVideoStateChange', this.broadcastStateChange.bind(this));
                window.addEventListener('beforeunload', () => {
                    if (this.saveTimeout) {
                        clearTimeout(this.saveTimeout);
                        this.savePreferences();
                    }
                });
            } catch (e) {
                console.error('Error initializing video state:', e);
                this.savePreferences();
            }
        },

        setupLazyLoadDetection() {
            const videoObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeName === 'VIDEO') {
                                this.preventMutingForVideo(node);
                                setTimeout(() => this.enforceStateOnVideo(node), 50);
                            } else if (node.querySelectorAll) {
                                node.querySelectorAll('video').forEach(video => {
                                    this.preventMutingForVideo(video);
                                    setTimeout(() => this.enforceStateOnVideo(video), 50);
                                });
                            }
                        });
                    }
                }
            });
            videoObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });
        },

        setupIntersectionObserver() {
            const intersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && entry.target.nodeName === 'VIDEO') {
                        this.enforceStateOnVideo(entry.target);
                    }
                });
            }, { rootMargin: '50px 0px', threshold: 0.1 });

            document.querySelectorAll('video').forEach(video => intersectionObserver.observe(video));

            const videoObserver = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeName === 'VIDEO') intersectionObserver.observe(node);
                        else if (node.querySelectorAll) node.querySelectorAll('video').forEach(video => intersectionObserver.observe(video));
                    });
                });
            });
            videoObserver.observe(document.body, { childList: true, subtree: true });
        },

        preventMutingForVideo(video) {
            installMutedGuard(video);
            setVideoMuted(video, false);
        },

        enforceStateOnVideo(video) {
            if (!video || !this.lastKnownGoodState) return;
            let controlInstance = null;
            this.activeControlInstances.forEach(instance => {
                if (instance.video === video) controlInstance = instance;
            });
            if (controlInstance) {
                controlInstance.forceApplyState(this.lastKnownGoodState);
            } else {
                setVideoMuted(video, this.lastKnownGoodState.isMuted);
                video.volume = this.lastKnownGoodState.volume;
                video.playbackRate = this.lastKnownGoodState.speed;
            }
        },

        isValidVolume(vol) { return typeof vol === 'number' && vol >= 0 && vol <= 1; },
        isValidSpeed(speed) { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(speed); },

        savePreferences() {
            try {
                this.preferences.lastUpdate = Date.now();
                localStorage.setItem('igVideoPreferences', JSON.stringify(this.preferences));
                this.lastKnownGoodState = { ...this.preferences };
            } catch (e) {
                console.error('Error saving preferences:', e);
            }
        },

        update(key, value) {
            if (this.saveTimeout) clearTimeout(this.saveTimeout);
            let isValid = true;
            if (key === 'volume') isValid = this.isValidVolume(value);
            else if (key === 'speed') isValid = this.isValidSpeed(value);

            if (isValid) {
                this.preferences[key] = value;
                this.preferences.lastUpdate = Date.now();
                this.lastKnownGoodState = { ...this.preferences };

                this.saveTimeout = setTimeout(() => {
                    this.savePreferences();
                    window.dispatchEvent(new CustomEvent('igVideoStateChange', { detail: { ...this.preferences } }));
                }, 300);
            }
        },

        registerInstance(controlInstance) {
            this.activeControlInstances.add(controlInstance);
            controlInstance.applyState(this.preferences);
        },

        unregisterInstance(controlInstance) {
            this.activeControlInstances.delete(controlInstance);
        },

        broadcastStateChange(event) {
            const newState = event.detail;
            this.activeControlInstances.forEach(instance => instance.applyState(newState));
        }
    };

    // DOM Utilities
    const DOMUtils = {
        createButton(options = {}) {
            const button = document.createElement('button');
            button.className = options.className || '';
            Object.assign(button.style, { ...UI.styles.button, ...options.style });
            if (options.innerHTML) button.innerHTML = options.innerHTML;
            if (options.onclick) button.addEventListener('click', options.onclick);
            return button;
        },

        createContainer(options = {}) {
            const container = document.createElement('div');
            container.className = options.className || '';
            Object.assign(container.style, { ...UI.styles.container, ...options.style });
            return container;
        },

        setupHoverMenu(control, menuContainer, delay = 500) {
            let timeout;
            const showMenu = () => {
                clearTimeout(timeout);
                menuContainer.style.display = menuContainer.dataset.displayType || 'block';
            };
            const hideMenu = () => {
                timeout = setTimeout(() => { menuContainer.style.display = 'none'; }, delay);
            };

            control.addEventListener('mouseenter', showMenu);
            control.addEventListener('mouseleave', hideMenu);
            menuContainer.addEventListener('mouseenter', () => clearTimeout(timeout));
            menuContainer.addEventListener('mouseleave', hideMenu);
            return { showMenu, hideMenu };
        },

        formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${String(secs).padStart(2, '0')}`;
        }
    };

    // Video Controls Class
    class VideoControls {
        constructor(videoElement) {
            this.video = videoElement;
            this.isDragging = false;
            this.isVolumeDragging = false;
            this.lastNonZeroVolume = VideoState.preferences.volume > 0 ? VideoState.preferences.volume : 1;
            this.eventListeners = new Set();
            VideoState.registerInstance(this);
            this.container = this.createControlsContainer();
            this.initializeVideoState();
        }

        addEventListener(element, type, handler) {
            element.addEventListener(type, handler);
            this.eventListeners.add({ element, type, handler });
        }

        removeAllEventListeners() {
            this.eventListeners.forEach(({ element, type, handler }) => {
                element.removeEventListener(type, handler);
            });
            this.eventListeners.clear();
        }

        createControlComponent(options) {
            const control = DOMUtils.createContainer({
                className: options.className,
                style: { flex: '0 0 auto', ...options.style }
            });

            const button = DOMUtils.createButton({
                className: options.buttonClassName,
                style: options.buttonStyle,
                innerHTML: options.buttonContent,
                onclick: options.onClick
            });

            control.appendChild(button);

            if (options.menu) {
                control.appendChild(options.menu);
                if (options.useHoverMenu) DOMUtils.setupHoverMenu(control, options.menu);
            }
            return { control, button };
        }

        createControlsContainer() {
            const container = DOMUtils.createContainer({
                className: 'ig-video-control',
                style: {
                    width: '100%',
                    minHeight: UI.sizes.controlHeight,
                    background: `linear-gradient(180deg, rgba(8,8,10,0), ${UI.colors.backgroundStrong})`,
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: '9999999',
                    position: 'relative',
                    pointerEvents: 'all',
                    boxSizing: 'border-box',
                    paddingTop: '18px',
                    backdropFilter: 'blur(2px)'
                }
            });

            container.appendChild(this.createTimeline());
            container.appendChild(this.createControlsRow());
            return container;
        }

        createControlsRow() {
            const row = DOMUtils.createContainer({
                className: 'ig-video-controls-row',
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '0 12px 10px',
                    minHeight: '34px',
                    position: 'relative',
                    zIndex: '9999999',
                    boxSizing: 'border-box'
                }
            });

            [this.createPlayButton(), this.createVolumeControl(), this.createTimeDisplay(),
             this.createSpeedControl(), this.createBackgroundPlayControl()
            ].forEach(control => row.appendChild(control));

            return row;
        }

        createPlayButton() {
            const updatePlayButton = (button) => { button.innerHTML = this.video.paused ? Icons.play : Icons.pause; };
            const { control, button } = this.createControlComponent({
                className: 'ig-video-play-control',
                buttonClassName: 'ig-video-control-button',
                buttonStyle: { width: UI.sizes.buttonSize, height: UI.sizes.buttonSize },
                buttonContent: this.video.paused ? Icons.play : Icons.pause,
                onClick: (e) => {
                    e.stopPropagation();
                    this.video.paused ? this.video.play() : this.video.pause();
                }
            });

            this.addEventListener(this.video, 'play', () => updatePlayButton(button));
            this.addEventListener(this.video, 'pause', () => updatePlayButton(button));
            return control;
        }

        createTimeDisplay() {
            const display = document.createElement('span');
            display.className = 'ig-video-time-display';
            Object.assign(display.style, {
                color: UI.colors.text, fontSize: UI.sizes.fontSize.normal,
                fontFamily: 'Arial, sans-serif',
                minWidth: '78px',
                textShadow: '0 1px 2px rgba(0,0,0,0.65)'
            });

            const updateTime = () => {
                const current = Math.floor(this.video.currentTime || 0);
                const total = Math.floor(this.video.duration || 0);
                display.textContent = `${DOMUtils.formatTime(current)} / ${DOMUtils.formatTime(total)}`;
            };

            this.addEventListener(this.video, 'timeupdate', updateTime);
            this.addEventListener(this.video, 'loadedmetadata', updateTime);
            updateTime();
            return display;
        }

        createSpeedControl() {
            const options = this.createSpeedOptions();
            options.style.display = 'none';

            return this.createControlComponent({
                className: 'ig-video-speed-control',
                buttonClassName: 'ig-video-speed-button',
                buttonStyle: { fontSize: UI.sizes.fontSize.normal, padding: '4px 8px', minWidth: '42px' },
                buttonContent: `${this.video.playbackRate}x`,
                style: { position: 'relative' },
                menu: options,
                useHoverMenu: false,
                onClick: (e) => {
                    e.stopPropagation();
                    const isVisible = options.style.display === 'flex';
                    options.style.display = isVisible ? 'none' : 'flex';
                    this.setControlsPinned(!isVisible);

                    if (!isVisible) {
                        const closeMenu = (event) => {
                            if (!options.contains(event.target)) {
                                options.style.display = 'none';
                                this.setControlsPinned(false);
                                document.removeEventListener('click', closeMenu);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', closeMenu), 0);
                    }
                }
            }).control;
        }

        createSpeedOptions() {
            const container = document.createElement('div');
            container.className = 'ig-video-speed-options';
            Object.assign(container.style, {
                position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
                transform: 'translateX(-50%)', background: UI.colors.background,
                borderRadius: '4px', display: 'none', flexDirection: 'column',
                minWidth: '80px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', zIndex: '10000001'
            });

            [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach(speed => {
                const option = DOMUtils.createButton({
                    className: 'ig-video-speed-option',
                    style: { padding: '8px 16px', fontSize: UI.sizes.fontSize.normal, width: '100%', textAlign: 'center' },
                    innerHTML: `${speed}x`,
                    onclick: (e) => {
                        e.stopPropagation();
                        this.video.playbackRate = speed;
                        VideoState.update('speed', speed);
                        container.style.display = 'none';
                        this.setControlsPinned(false);
                    }
                });
                container.appendChild(option);
            });
            return container;
        }

        createVolumeControl() {
            const control = DOMUtils.createContainer({
                className: 'ig-video-volume-control',
                style: {
                    alignItems: 'center',
                    gap: '7px',
                    minWidth: '32px',
                    overflow: 'visible'
                }
            });

            const button = DOMUtils.createButton({
                className: 'ig-video-volume-button',
                style: { fontSize: UI.sizes.fontSize.large, width: UI.sizes.buttonSize, height: UI.sizes.buttonSize },
                innerHTML: this.getVolumeIcon(),
                onclick: (e) => {
                    e.stopPropagation();
                    const shouldMute = !this.video.muted;
                    if (shouldMute && this.video.volume > 0) {
                        this.lastNonZeroVolume = this.video.volume;
                    } else if (!shouldMute && this.video.volume === 0) {
                        this.video.volume = this.lastNonZeroVolume || VideoState.preferences.volume || 1;
                        VideoState.update('volume', this.video.volume);
                    }
                    setVideoMuted(this.video, shouldMute);
                    VideoState.update('isMuted', this.video.muted);
                    this.updateVolumeUI();
                }
            });

            control.appendChild(button);
            control.appendChild(this.createVolumeSlider());
            return control;
        }

        getVolumePercent() {
            if (!this.video || this.video.muted) return 0;
            return Math.round(Math.max(0, Math.min(1, this.video.volume || 0)) * 100);
        }

        paintVolumeSlider(slider, percent = this.getVolumePercent()) {
            if (!slider) return;
            const clampedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
            slider.value = String(clampedPercent);
            slider.style.setProperty('--ig-volume-progress', `${clampedPercent}%`);
            slider.style.background = `linear-gradient(to right, ${UI.colors.primary} 0%, ${UI.colors.primary} ${clampedPercent}%, ${UI.colors.track} ${clampedPercent}%, ${UI.colors.track} 100%)`;
        }

        setVolumeFromPercent(percent) {
            const value = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
            this.video.volume = value;
            if (value > 0) this.lastNonZeroVolume = value;
            setVideoMuted(this.video, value === 0);
            VideoState.update('volume', value);
            VideoState.update('isMuted', this.video.muted);
            this.updateVolumeUI();
        }

        setVolumeFromClientX(slider, clientX) {
            const rect = slider.getBoundingClientRect();
            if (!rect.width) return;
            this.setVolumeFromPercent(((clientX - rect.left) / rect.width) * 100);
        }

        createVolumeSlider() {
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            slider.step = '1';
            slider.className = 'ig-video-slider';
            Object.assign(slider.style, {
                width: '74px',
                height: '6px',
                borderRadius: '999px',
                cursor: 'pointer',
                outline: 'none'
            });
            this.paintVolumeSlider(slider);

            this.addEventListener(slider, 'input', (e) => {
                this.setVolumeFromPercent(e.target.value);
            });

            this.addEventListener(slider, 'mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.isVolumeDragging = true;
                const volumeControl = slider.closest('.ig-video-volume-control');
                if (volumeControl) {
                    volumeControl.classList.add('ig-video-volume-expanded');
                    volumeControl.dataset.igVolumeDragging = 'true';
                }
                this.setVolumeFromClientX(slider, e.clientX);

                const handleMouseMove = (event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    this.setVolumeFromClientX(slider, event.clientX);
                };
                const handleMouseUp = () => {
                    this.isVolumeDragging = false;
                    const volumeControl = slider.closest('.ig-video-volume-control');
                    if (volumeControl) {
                        delete volumeControl.dataset.igVolumeDragging;
                        if (!volumeControl.matches(':hover')) {
                            volumeControl.classList.remove('ig-video-volume-expanded');
                        }
                    }
                    window.removeEventListener('mousemove', handleMouseMove, true);
                    window.removeEventListener('mouseup', handleMouseUp, true);
                };

                window.addEventListener('mousemove', handleMouseMove, true);
                window.addEventListener('mouseup', handleMouseUp, true);
            });

            return slider;
        }

        createBackgroundPlayControl() {
            const updateBgPlayButton = (button) => {
                button.innerHTML = VideoState.preferences.backgroundPlay ? 'BG' : 'BG';
                button.title = VideoState.preferences.backgroundPlay ? 'Video will continue in background' : 'Video will pause in background';
                button.style.opacity = VideoState.preferences.backgroundPlay ? '1' : '0.7';
            };

            const { control, button } = this.createControlComponent({
                className: 'ig-video-bgplay-control',
                buttonClassName: 'ig-video-control-button',
                buttonStyle: { fontSize: '12px', fontWeight: '700', padding: '4px 8px', opacity: VideoState.preferences.backgroundPlay ? '1' : '0.7' },
                buttonContent: 'BG',
                onClick: (e) => {
                    e.stopPropagation();
                    const newState = !VideoState.preferences.backgroundPlay;
                    VideoState.update('backgroundPlay', newState);
                    updateBgPlayButton(button);
                    newState ? this.enableBackgroundPlay() : this.disableBackgroundPlay();
                }
            });
            return control;
        }

        createTimeline() {
            const timeline = document.createElement('div');
            timeline.className = 'ig-video-timeline';
            Object.assign(timeline.style, { width: '100%', height: UI.sizes.timelineHeight, background: 'rgba(255,255,255,0.2)', position: 'relative', transition: 'height 0.1s' });

            const progress = document.createElement('div');
            progress.className = 'ig-video-progress';
            Object.assign(progress.style, { height: '100%', background: UI.colors.primary, width: '0%', position: 'absolute', top: '0', left: '0' });

            const seekHandle = document.createElement('div');
            seekHandle.className = 'ig-video-seek-handle';
            Object.assign(seekHandle.style, {
                width: '12px', height: '12px', background: UI.colors.primary, borderRadius: '50%',
                position: 'absolute', right: '-6px', top: '50%', transform: 'translateY(-50%) scale(0)', transition: 'transform 0.1s'
            });

            const tooltip = document.createElement('div');
            tooltip.className = 'ig-video-tooltip';
            Object.assign(tooltip.style, {
                position: 'absolute', background: UI.colors.background, color: UI.colors.text,
                padding: '4px 8px', borderRadius: '4px', fontSize: UI.sizes.fontSize.normal,
                bottom: '100%', transform: 'translateX(-50%)', display: 'none', zIndex: '10000000',
                pointerEvents: 'none', whiteSpace: 'nowrap', marginBottom: '8px'
            });

            progress.appendChild(seekHandle);
            timeline.appendChild(progress);

            const container = DOMUtils.createContainer({
                className: 'ig-video-timeline-container',
                style: { width: '100%', height: '20px', position: 'relative', cursor: 'pointer', padding: '8px 0', zIndex: '9999999' }
            });

            container.appendChild(timeline);
            container.appendChild(tooltip);
            this.setupTimelineEvents(container, timeline, progress, seekHandle, tooltip);
            return container;
        }

        setupTimelineEvents(container, timeline, progress, seekHandle, tooltip) {
            const updateTimelinePosition = (e) => {
                if (!this.isDragging) return;
                const rect = timeline.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const newTime = this.video.duration * pos;
                progress.style.width = `${pos * 100}%`;
                tooltip.style.left = `${pos * 100}%`;
                tooltip.textContent = DOMUtils.formatTime(newTime);
                this.video.currentTime = newTime;
            };

            this.addEventListener(container, 'mousedown', (e) => {
                e.stopPropagation();
                this.isDragging = true;
                this.setControlsPinned(true);
                timeline.style.height = UI.sizes.timelineActiveHeight;
                seekHandle.style.transform = 'translateY(-50%) scale(1)';
                updateTimelinePosition(e);

                const handleMouseMove = (e) => updateTimelinePosition(e);
                const handleMouseUp = () => {
                    this.isDragging = false;
                    this.setControlsPinned(false);
                    timeline.style.height = UI.sizes.timelineHeight;
                    seekHandle.style.transform = 'translateY(-50%) scale(0)';
                    document.removeEventListener('mousemove', handleMouseMove);
                    window.removeEventListener('mouseup', handleMouseUp, true);
                };
                document.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp, true);

            });

            this.addEventListener(container, 'mousemove', (e) => {
                const rect = timeline.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                if (!this.isDragging) {
                    tooltip.style.display = 'block';
                    tooltip.style.left = `${pos * 100}%`;
                    tooltip.textContent = DOMUtils.formatTime(this.video.duration * pos);
                }
            });

            this.addEventListener(container, 'mouseleave', () => {
                if (!this.isDragging) {
                    tooltip.style.display = 'none';
                    timeline.style.height = UI.sizes.timelineHeight;
                    seekHandle.style.transform = 'translateY(-50%) scale(0)';
                }
            });

            this.addEventListener(container, 'mouseenter', () => {
                if (!this.isDragging) {
                    timeline.style.height = UI.sizes.timelineActiveHeight;
                    seekHandle.style.transform = 'translateY(-50%) scale(1)';
                }
            });

            this.addEventListener(this.video, 'timeupdate', () => {
                if (!this.isDragging && this.video.duration) {
                    const progressValue = (this.video.currentTime / this.video.duration) * 100;
                    progress.style.width = `${progressValue}%`;
                }
            });
        }

        initializeVideoState() {
            if (this.video) {
                setVideoMuted(this.video, false);
                if (this.video.volume === 0) this.video.volume = VideoState.preferences.volume;
                this.setupVideoListeners();
                this.applyState(VideoState.preferences);
            }
        }

        setControlsPinned(pinned) {
            const wrapper = this.container && this.container.closest('.ig-video-controls-wrapper');
            if (!wrapper) return;
            wrapper.classList.toggle('ig-video-controls-pinned', Boolean(pinned));
        }

        setupVideoListeners() {
            this.addEventListener(this.video, 'volumechange', () => {
                if (this.video.muted !== VideoState.preferences.isMuted) {
                    VideoState.update('isMuted', this.video.muted);
                    this.updateVolumeUI();
                }
                if (!this.video.muted && this.video.volume !== VideoState.preferences.volume) {
                    if (this.video.volume > 0) this.lastNonZeroVolume = this.video.volume;
                    VideoState.update('volume', this.video.volume);
                    this.updateVolumeUI();
                }
            });
            this.addEventListener(this.video, 'ratechange', () => {
                if (this.video.playbackRate !== VideoState.preferences.speed) {
                    VideoState.update('speed', this.video.playbackRate);
                    this.updateSpeedUI();
                }
            });
        }

        applyState(state) {
            if (this.video) {
                this.video.playbackRate = state.speed;
                this.video.volume = state.volume;
                if (state.volume > 0) this.lastNonZeroVolume = state.volume;
                setVideoMuted(this.video, state.isMuted);
                if (this.container) {
                    this.updateVolumeUI();
                    this.updateSpeedUI();
                    this.updateBackgroundPlayUI();
                }
                state.backgroundPlay ? this.enableBackgroundPlay() : this.disableBackgroundPlay();
            }
        }

        forceApplyState(state) {
            if (this.video) {
                this.video.volume = state.volume;
                if (state.volume > 0) this.lastNonZeroVolume = state.volume;
                setVideoMuted(this.video, state.isMuted);
                this.video.playbackRate = state.speed;
                if (this.container) {
                    const volumeButton = this.container.querySelector('.ig-video-volume-button');
                    const volumeSlider = this.container.querySelector('.ig-video-slider');
                    const speedButton = this.container.querySelector('.ig-video-speed-button');
                    const bgPlayButton = this.container.querySelector('.ig-video-bgplay-control .ig-video-control-button');

                    if (volumeButton) volumeButton.innerHTML = this.getVolumeIcon();
                    if (volumeSlider) this.paintVolumeSlider(volumeSlider, state.isMuted ? 0 : state.volume * 100);
                    if (speedButton) speedButton.innerHTML = `${state.speed}x`;
                    if (bgPlayButton) {
                        bgPlayButton.innerHTML = 'BG';
                        bgPlayButton.style.opacity = state.backgroundPlay ? '1' : '0.7';
                    }
                }
                state.backgroundPlay ? this.enableBackgroundPlay() : this.disableBackgroundPlay();
            }
        }

        updateVolumeUI() {
            const button = this.container.querySelector('.ig-video-volume-button');
            const slider = this.container.querySelector('.ig-video-slider');
            if (button) button.innerHTML = this.getVolumeIcon();
            if (slider) this.paintVolumeSlider(slider);
        }

        getVolumeIcon() {
            if (this.video.muted || this.video.volume === 0) return Icons.volumeMuted;
            if (this.video.volume < 0.5) return Icons.volumeLow;
            return Icons.volumeHigh;
        }

        updateSpeedUI() {
            const button = this.container.querySelector('.ig-video-speed-button');
            if (button) button.innerHTML = `${this.video.playbackRate}x`;
        }

        updateBackgroundPlayUI() {
            const button = this.container.querySelector('.ig-video-bgplay-control .ig-video-control-button');
            if (button) {
                button.innerHTML = 'BG';
                button.style.opacity = VideoState.preferences.backgroundPlay ? '1' : '0.7';
            }
        }

        enableBackgroundPlay() {
            if (!this.video._originalPause) {
                this.video._originalPause = this.video.pause;
                this.video.pause = () => {
                    if (document.visibilityState === 'hidden' && !this.video.ended) return Promise.resolve();
                    return this.video._originalPause.call(this.video);
                };
            }
        }

        disableBackgroundPlay() {
            if (this.video._originalPause) {
                this.video.pause = this.video._originalPause;
                delete this.video._originalPause;
            }
        }

        destroy() {
            VideoState.unregisterInstance(this);
            this.removeAllEventListeners();
            if (this.container) this.container.remove();
        }
    }

    const addStyles = () => {
        const styles = `
            .ig-video-control,
            .ig-video-control * {
                box-sizing: border-box;
            }
            .ig-video-control button {
                border-radius: 999px;
                text-shadow: 0 1px 2px rgba(0,0,0,0.65);
            }
            .ig-video-control button svg {
                width: 20px;
                height: 20px;
                display: block;
            }
            .ig-video-play-control button svg {
                width: 22px;
                height: 22px;
            }
            .ig-video-slider {
                -webkit-appearance: none;
                appearance: none;
                width: 0 !important;
                min-width: 0;
                max-width: 0;
                opacity: 0;
                overflow: hidden;
                pointer-events: none;
                transition: max-width 0.16s ease, opacity 0.16s ease;
            }
            .ig-video-volume-control:hover .ig-video-slider,
            .ig-video-volume-control:focus-within .ig-video-slider,
            .ig-video-volume-control.ig-video-volume-expanded .ig-video-slider {
                width: 74px !important;
                max-width: 74px;
                opacity: 1;
                pointer-events: auto;
            }
            .ig-video-slider::-webkit-slider-runnable-track {
                height: 6px;
                border-radius: 999px;
                background: transparent;
            }
            .ig-video-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: ${UI.colors.primary}; border-radius: 50%; cursor: pointer; margin-top: -3px; }
            .ig-video-slider::-moz-range-track { height: 6px; border-radius: 999px; background: ${UI.colors.track}; }
            .ig-video-slider::-moz-range-progress { height: 6px; border-radius: 999px; background: ${UI.colors.primary}; }
            .ig-video-slider::-moz-range-thumb { width: 12px; height: 12px; background: ${UI.colors.primary}; border-radius: 50%; cursor: pointer; border: none; }
            .ig-video-control-button,
            .ig-video-speed-button,
            .ig-video-volume-button {
                min-width: 32px;
                min-height: 32px;
            }
            .ig-video-control-button:hover,
            .ig-video-speed-button:hover,
            .ig-video-volume-button:hover {
                background: rgba(255,255,255,0.14);
                opacity: 1;
            }
            .ig-video-speed-option:hover { background: ${UI.colors.hover}; }
            .ig-video-controls-wrapper {
                opacity: 0.94;
                transition: opacity 0.18s ease;
            }
            .ig-video-controls-wrapper:hover {
                opacity: 1;
            }
        `;
        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    };

    const initVideoControls = () => {
        const processedVideos = new WeakSet();

        const addControlsToVideo = (videoElement) => {
            if (processedVideos.has(videoElement)) return;
            const videoContainer = videoElement.closest('div[class*="x5yr21d"][class*="x1uhb9sk"]');
            if (!videoContainer) return;

            installMutedGuard(videoElement);
            setVideoMuted(videoElement, false);
            processedVideos.add(videoElement);

            const controls = new VideoControls(videoElement);
            const controlsWrapper = DOMUtils.createContainer({
                className: 'ig-video-controls-wrapper',
                style: {
                    width: '100%',
                    position: 'absolute',
                    left: '0',
                    right: '0',
                    bottom: '0',
                    zIndex: '9999999',
                    pointerEvents: 'none'
                }
            });

            controlsWrapper.appendChild(controls.container);
            videoContainer.style.position = 'relative';
            videoContainer.appendChild(controlsWrapper);

            const observer = new MutationObserver(() => {
                if (!document.contains(videoElement)) {
                    controls.destroy();
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        };

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'VIDEO') addControlsToVideo(node);
                    else if (node.querySelectorAll) node.querySelectorAll('video').forEach(addControlsToVideo);
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class'] });
        document.querySelectorAll('video').forEach(addControlsToVideo);
    };

    const initialize = () => {
        VideoState.initialize();
        addStyles();
        ShieldBypass.init(); // <--- Bypass initialized here
        initVideoControls();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
})();
