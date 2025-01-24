// ==UserScript==
// @name         Instagram Video Controls - Enhanced State Management
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Video controls for Instagram with persistent state across videos
// @match        https://www.instagram.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Prevent automatic video muting
    const createElementOriginal = document.createElement;
    document.createElement = function(tag) {
        const element = createElementOriginal.call(document, tag);
        if (tag.toLowerCase() === 'video') {
            Object.defineProperty(element, 'muted', {
                configurable: false,
                get: function() { return false; },
                set: function(value) { return false; }
            });
        }
        return element;
    }

    // Enhanced State management with global event handling
    const VideoState = {
        preferences: {
            volume: 1,
            speed: 1,
            backgroundPlay: false,
            isMuted: false
        },
        activeControlInstances: new Set(),

        initialize() {
            try {
                const saved = JSON.parse(localStorage.getItem('igVideoPreferences'));
                if (saved) {
                    this.preferences = { ...this.preferences, ...saved };
                }
                window.addEventListener('igVideoStateChange', this.broadcastStateChange.bind(this));
            } catch (e) {
                console.error('Error loading preferences:', e);
            }
        },

        save() {
            try {
                localStorage.setItem('igVideoPreferences', JSON.stringify(this.preferences));
                window.dispatchEvent(new CustomEvent('igVideoStateChange', {
                    detail: { ...this.preferences }
                }));
            } catch (e) {
                console.error('Error saving preferences:', e);
            }
        },

        update(key, value) {
            this.preferences[key] = value;
            this.save();
        },

        registerInstance(controlInstance) {
            this.activeControlInstances.add(controlInstance);
        },

        unregisterInstance(controlInstance) {
            this.activeControlInstances.delete(controlInstance);
        },

        broadcastStateChange(event) {
            const newState = event.detail;
            this.activeControlInstances.forEach(instance => {
                instance.applyState(newState);
            });
        },

        getInitialState(video) {
            return {
                volume: video.volume,
                speed: video.playbackRate,
                isMuted: video.muted
            };
        }
    };

    // UI Constants
    const UI = {
        colors: {
            primary: '#0095f6',
            background: 'rgba(0,0,0,0.8)',
            text: '#ffffff',
            hover: 'rgba(255,255,255,0.1)'
        },
        sizes: {
            buttonSize: '32px',
            fontSize: {
                normal: '14px',
                large: '20px'
            },
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
                transition: 'opacity 0.2s'
            },
            container: {
                display: 'flex',
                position: 'relative'
            }
        }
    };

    // Utility functions for DOM manipulation and event handling
    const DOMUtils = {
        createButton(options = {}) {
            const button = document.createElement('button');
            button.className = options.className || '';
            Object.assign(button.style, {
                ...UI.styles.button,
                ...options.style
            });
            if (options.innerHTML) button.innerHTML = options.innerHTML;
            if (options.onclick) button.addEventListener('click', options.onclick);
            return button;
        },

        createContainer(options = {}) {
            const container = document.createElement('div');
            container.className = options.className || '';
            Object.assign(container.style, {
                ...UI.styles.container,
                ...options.style
            });
            return container;
        },

        setupHoverMenu(control, menuContainer, delay = 500) {
            let timeout;

            const showMenu = () => {
                clearTimeout(timeout);
                menuContainer.style.display = menuContainer.dataset.displayType || 'block';
            };

            const hideMenu = () => {
                timeout = setTimeout(() => {
                    menuContainer.style.display = 'none';
                }, delay);
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

    class VideoControls {
        constructor(videoElement) {
            this.video = videoElement;
            this.isDragging = false;
            this.eventListeners = new Set();

            VideoState.registerInstance(this);
            const initialState = VideoState.getInitialState(this.video);

            if (initialState.isMuted !== VideoState.preferences.isMuted) {
                VideoState.update('isMuted', initialState.isMuted);
            }
            if (initialState.volume !== VideoState.preferences.volume && initialState.volume !== 0) {
                VideoState.update('volume', initialState.volume);
            }

            this.applyState(VideoState.preferences);
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
                style: { marginRight: '12px', ...options.style }
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
                DOMUtils.setupHoverMenu(control, options.menu);
            }

            return { control, button };
        }

        createControlsContainer() {
            const container = DOMUtils.createContainer({
                className: 'ig-video-control',
                style: {
                    width: '100%',
                    height: UI.sizes.controlHeight,
                    background: UI.colors.background,
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: '9999999',
                    position: 'relative',
                    pointerEvents: 'all'
                }
            });

            const timeline = this.createTimeline();
            const controls = this.createControlsRow();

            container.appendChild(timeline);
            container.appendChild(controls);

            return container;
        }

        createControlsRow() {
            const row = DOMUtils.createContainer({
                className: 'ig-video-controls-row',
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    height: '28px',
                    position: 'relative',
                    zIndex: '9999999'
                }
            });

            const controls = [
                this.createPlayButton(),
                this.createTimeDisplay(),
                this.createSpeedControl(),
                this.createBackgroundPlayControl(),
                this.createVolumeControl()
            ];

            controls.forEach(control => row.appendChild(control));
            return row;
        }

        createPlayButton() {
            const updatePlayButton = (button) => {
                button.innerHTML = this.video.paused ? '⏵️' : '⏸️';
            };

            const { control, button } = this.createControlComponent({
                className: 'ig-video-play-control',
                buttonClassName: 'ig-video-control-button',
                buttonStyle: {
                    fontSize: '24px',
                    width: UI.sizes.buttonSize,
                    height: UI.sizes.buttonSize
                },
                buttonContent: this.video.paused ? '⏵️' : '⏸️',
                onClick: (e) => {
                    e.stopPropagation();
                    if (this.video.paused) {
                        this.video.play();
                    } else {
                        this.video.pause();
                    }
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
                color: UI.colors.text,
                fontSize: UI.sizes.fontSize.normal,
                marginRight: '12px',
                fontFamily: 'monospace'
            });

            const updateTime = () => {
                const current = Math.floor(this.video.currentTime);
                const total = Math.floor(this.video.duration);
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
            options.dataset.displayType = 'flex';

            return this.createControlComponent({
                className: 'ig-video-speed-control',
                buttonClassName: 'ig-video-speed-button',
                buttonStyle: {
                    fontSize: UI.sizes.fontSize.normal,
                    padding: '4px 8px'
                },
                buttonContent: `${this.video.playbackRate}x`,
                menu: options
            }).control;
        }

        createSpeedOptions() {
            const container = document.createElement('div');
            container.className = 'ig-video-speed-options';
            Object.assign(container.style, {
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: UI.colors.background,
                borderRadius: '4px',
                flexDirection: 'column',
                marginTop: '8px',
                minWidth: '80px',
                zIndex: '10000001'
            });

            [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach(speed => {
                const option = DOMUtils.createButton({
                    className: 'ig-video-speed-option',
                    style: {
                        padding: '8px 16px',
                        fontSize: UI.sizes.fontSize.normal,
                        width: '100%',
                        textAlign: 'center'
                    },
                    innerHTML: `${speed}x`,
                    onclick: (e) => {
                        e.stopPropagation();
                        this.video.playbackRate = speed;
                        VideoState.update('speed', speed);
                        container.style.display = 'none';
                    }
                });

                container.appendChild(option);
            });

            return container;
        }

        createVolumeControl() {
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'ig-video-volume-slider-container';
            Object.assign(sliderContainer.style, {
                position: 'absolute',
                left: '25px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: UI.colors.background,
                padding: '10px',
                borderRadius: '4px',
                display: 'none'
            });

            const slider = this.createVolumeSlider();
            sliderContainer.appendChild(slider);

            const { control } = this.createControlComponent({
                className: 'ig-video-volume-control',
                buttonClassName: 'ig-video-volume-button',
                buttonStyle: {
                    fontSize: UI.sizes.fontSize.large,
                    width: UI.sizes.buttonSize,
                    height: UI.sizes.buttonSize
                },
                buttonContent: this.video.muted ? '🔇' : '🔊',
                onClick: (e) => {
                    e.stopPropagation();
                    this.video.muted = !this.video.muted;
                    VideoState.update('isMuted', this.video.muted);
                    this.updateVolumeUI();
                },
                menu: sliderContainer
            });

            return control;
        }

        createVolumeSlider() {
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            slider.value = this.video.volume * 100;
            slider.className = 'ig-video-slider';
            Object.assign(slider.style, {
                width: '100px',
                height: '4px',
                background: 'rgba(255,255,255,0.2)',
                cursor: 'pointer'
            });

            this.addEventListener(slider, 'input', (e) => {
                const value = e.target.value / 100;
                this.video.volume = value;
                this.video.muted = value === 0;
                VideoState.update('volume', value);
                VideoState.update('isMuted', this.video.muted);
                this.updateVolumeUI();
            });

            return slider;
        }


        // ... continuing VideoControls class

        createBackgroundPlayControl() {
            const updateBgPlayButton = (button) => {
                button.innerHTML = VideoState.preferences.backgroundPlay ? '🔓' : '🔒';
                button.title = VideoState.preferences.backgroundPlay ?
                    'Video will continue in background' :
                    'Video will pause in background';
                button.style.opacity = VideoState.preferences.backgroundPlay ? '1' : '0.7';
            };

            const { control, button } = this.createControlComponent({
                className: 'ig-video-bgplay-control',
                buttonClassName: 'ig-video-control-button',
                buttonStyle: {
                    fontSize: UI.sizes.fontSize.normal,
                    padding: '4px 8px',
                    opacity: VideoState.preferences.backgroundPlay ? '1' : '0.7'
                },
                buttonContent: VideoState.preferences.backgroundPlay ? '🔓' : '🔒',
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
            const { timeline, progress, seekHandle, tooltip } = this.createTimelineElements();
            const container = this.setupTimelineContainer(timeline, progress, seekHandle, tooltip);
            this.setupTimelineEvents(container, timeline, progress, seekHandle, tooltip);
            return container;
        }

        createTimelineElements() {
            const timeline = document.createElement('div');
            timeline.className = 'ig-video-timeline';
            Object.assign(timeline.style, {
                width: '100%',
                height: UI.sizes.timelineHeight,
                background: 'rgba(255,255,255,0.2)',
                position: 'relative',
                transition: 'height 0.1s'
            });

            const progress = document.createElement('div');
            progress.className = 'ig-video-progress';
            Object.assign(progress.style, {
                height: '100%',
                background: UI.colors.primary,
                width: '0%',
                position: 'absolute',
                top: '0',
                left: '0'
            });

            const seekHandle = document.createElement('div');
            seekHandle.className = 'ig-video-seek-handle';
            Object.assign(seekHandle.style, {
                width: '12px',
                height: '12px',
                background: UI.colors.primary,
                borderRadius: '50%',
                position: 'absolute',
                right: '-6px',
                top: '50%',
                transform: 'translateY(-50%) scale(0)',
                transition: 'transform 0.1s'
            });

            const tooltip = document.createElement('div');
            tooltip.className = 'ig-video-tooltip';
            Object.assign(tooltip.style, {
                position: 'absolute',
                background: UI.colors.background,
                color: UI.colors.text,
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: UI.sizes.fontSize.normal,
                bottom: '100%',
                transform: 'translateX(-50%)',
                display: 'none',
                zIndex: '10000000',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                marginBottom: '8px'
            });

            progress.appendChild(seekHandle);
            return { timeline, progress, seekHandle, tooltip };
        }

        setupTimelineContainer(timeline, progress, seekHandle, tooltip) {
            const container = DOMUtils.createContainer({
                className: 'ig-video-timeline-container',
                style: {
                    width: '100%',
                    height: '20px',
                    position: 'relative',
                    cursor: 'pointer',
                    padding: '8px 0',
                    zIndex: '9999999'
                }
            });

            timeline.appendChild(progress);
            container.appendChild(timeline);
            container.appendChild(tooltip);

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

            this.setupTimelineDragEvents(container, timeline, seekHandle, updateTimelinePosition);
            this.setupTimelineHoverEvents(container, timeline, seekHandle, tooltip);
            this.setupTimelineProgressUpdate(progress);
        }

        setupTimelineDragEvents(container, timeline, seekHandle, updateTimelinePosition) {
            this.addEventListener(container, 'mousedown', (e) => {
                e.stopPropagation();
                this.isDragging = true;
                timeline.style.height = UI.sizes.timelineActiveHeight;
                seekHandle.style.transform = 'translateY(-50%) scale(1)';
                updateTimelinePosition(e);

                const handleMouseMove = (e) => updateTimelinePosition(e);
                const handleMouseUp = () => {
                    this.isDragging = false;
                    timeline.style.height = UI.sizes.timelineHeight;
                    seekHandle.style.transform = 'translateY(-50%) scale(0)';
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                };

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            });
        }

        setupTimelineHoverEvents(container, timeline, seekHandle, tooltip) {
            this.addEventListener(container, 'mousemove', (e) => {
                const rect = timeline.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

                if (!this.isDragging) {
                    tooltip.style.display = 'block';
                    tooltip.style.left = `${pos * 100}%`;
                    const previewTime = this.video.duration * pos;
                    tooltip.textContent = DOMUtils.formatTime(previewTime);
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
        }

        setupTimelineProgressUpdate(progress) {
            this.addEventListener(this.video, 'timeupdate', () => {
                if (!this.isDragging) {
                    const progressValue = (this.video.currentTime / this.video.duration) * 100;
                    progress.style.width = `${progressValue}%`;
                }
            });
        }

        initializeVideoState() {
            this.setupVideoListeners();
            this.applyState(VideoState.preferences);
        }

        setupVideoListeners() {
            this.addEventListener(this.video, 'volumechange', () => {
                if (this.video.muted !== VideoState.preferences.isMuted) {
                    VideoState.update('isMuted', this.video.muted);
                    this.updateVolumeUI();
                }
                if (!this.video.muted && this.video.volume !== VideoState.preferences.volume) {
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
                this.video.muted = state.isMuted;

                if (this.container) {
                    this.updateVolumeUI();
                    this.updateSpeedUI();
                    this.updateBackgroundPlayUI();
                }

                state.backgroundPlay ? this.enableBackgroundPlay() : this.disableBackgroundPlay();
            }
        }

        updateVolumeUI() {
            const button = this.container.querySelector('.ig-video-volume-button');
            const slider = this.container.querySelector('.ig-video-slider');
            if (button) button.innerHTML = this.video.muted ? '🔇' : '🔊';
            if (slider) slider.value = this.video.muted ? 0 : this.video.volume * 100;
        }

        updateSpeedUI() {
            const button = this.container.querySelector('.ig-video-speed-button');
            if (button) button.innerHTML = `${this.video.playbackRate}x`;
        }

        updateBackgroundPlayUI() {
            const button = this.container.querySelector('.ig-video-bgplay-control .ig-video-control-button');
            if (button) {
                button.innerHTML = VideoState.preferences.backgroundPlay ? '🔓' : '🔒';
                button.style.opacity = VideoState.preferences.backgroundPlay ? '1' : '0.7';
            }
        }

        enableBackgroundPlay() {
            if (!this.video._originalPause) {
                this.video._originalPause = this.video.pause;
                this.video.pause = () => {
                    if (document.visibilityState === 'hidden' && !this.video.ended) {
                        return Promise.resolve();
                    }
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
            if (this.container) {
                this.container.remove();
            }
        }
    }

    // Add global styles
    const addStyles = () => {
        const styles = `
            .ig-video-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 12px;
                height: 12px;
                background: ${UI.colors.primary};
                border-radius: 50%;
                cursor: pointer;
            }
            .ig-video-slider::-moz-range-thumb {
                width: 12px;
                height: 12px;
                background: ${UI.colors.primary};
                border-radius: 50%;
                cursor: pointer;
                border: none;
            }
            .ig-video-control-button:hover {
                opacity: 0.8;
            }
            .ig-video-speed-option:hover {
                background: ${UI.colors.hover};
            }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    };

    // Initialize video controls with enhanced observer
    const initVideoControls = () => {
        const processedVideos = new WeakSet();

        const addControlsToVideo = (videoElement) => {
            if (processedVideos.has(videoElement)) return;

            const videoContainer = videoElement.closest('div[class*="x5yr21d"][class*="x1uhb9sk"]');
            if (!videoContainer) return;

            processedVideos.add(videoElement);
            const controls = new VideoControls(videoElement);

            const controlsWrapper = DOMUtils.createContainer({
                className: 'ig-video-controls-wrapper',
                style: {
                    width: '100%',
                    position: 'relative',
                    zIndex: '9999999'
                }
            });

            controlsWrapper.appendChild(controls.container);
            videoContainer.parentElement.insertBefore(controlsWrapper, videoContainer);
            videoContainer.style.position = 'relative';
            videoContainer.style.zIndex = '1';

            const observer = new MutationObserver((mutations) => {
                if (!document.contains(videoElement)) {
                    controls.destroy();
                    observer.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        };

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'VIDEO') {
                        addControlsToVideo(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(addControlsToVideo);
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'style', 'class']
        });

        document.querySelectorAll('video').forEach(addControlsToVideo);
    };

    // Initialize everything
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            VideoState.initialize();
            addStyles();
            initVideoControls();
        });
    } else {
        VideoState.initialize();
        addStyles();
        initVideoControls();
    }
})();
