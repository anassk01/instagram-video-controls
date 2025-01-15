// ==UserScript==
// @name         Instagram Video Controls - Fixed Version
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add better video controls to Instagram videos
// @match        https://www.instagram.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const createControls = (videoElement) => {
        // Main container
        const container = document.createElement('div');
        container.style.cssText = `
            width: 100%;
            height: 48px;
            background: rgba(0,0,0,0.8);
            display: flex;
            flex-direction: column;
            z-index: 9999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            position: relative;
            pointer-events: all !important;
        `;

        // Timeline container
        const timelineContainer = document.createElement('div');
        timelineContainer.style.cssText = `
            width: 100%;
            height: 20px;
            position: relative;
            cursor: pointer;
            padding: 8px 0;
            z-index: 9999999;
            pointer-events: all !important;
        `;

        // Timeline bar
        const timeline = document.createElement('div');
        timeline.style.cssText = `
            width: 100%;
            height: 3px;
            background: rgba(255,255,255,0.2);
            position: relative;
            transition: height 0.1s;
            z-index: 9999999;
        `;

        // Progress bar
        const progress = document.createElement('div');
        progress.style.cssText = `
            height: 100%;
            background: #0095f6;
            width: 0%;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 9999999;
        `;

        // Seek handle
        const seekHandle = document.createElement('div');
        seekHandle.style.cssText = `
            width: 12px;
            height: 12px;
            background: #0095f6;
            border-radius: 50%;
            position: absolute;
            right: -6px;
            top: 50%;
            transform: translateY(-50%) scale(0);
            transition: transform 0.1s;
            z-index: 10000000;
        `;
        progress.appendChild(seekHandle);

        // Time tooltip
        const timeTooltip = document.createElement('div');
        timeTooltip.style.cssText = `
            position: absolute;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            bottom: 100%;
            transform: translateX(-50%);
            display: none;
            z-index: 10000000;
            pointer-events: none;
            white-space: nowrap;
            margin-bottom: 8px;
        `;

        // Controls row
        const controlsRow = document.createElement('div');
        controlsRow.style.cssText = `
            display: flex;
            align-items: center;
            padding: 0 12px;
            height: 28px;
            position: relative;
            z-index: 9999999;
            pointer-events: all !important;
        `;

        // Play button
        const playButton = document.createElement('button');
        playButton.innerHTML = '⏵️';
        playButton.style.cssText = `
            background: none;
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            margin-right: 12px;
            position: relative;
            z-index: 10000000;
            pointer-events: all !important;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
        `;

        // Time display
        const timeDisplay = document.createElement('span');
        timeDisplay.style.cssText = `
            color: white;
            font-size: 13px;
            margin-right: 12px;
            font-family: monospace;
            position: relative;
            z-index: 10000000;
        `;

        // Volume control
        const volumeControl = document.createElement('div');
        volumeControl.style.cssText = `
            display: flex;
            align-items: center;
            position: relative;
            z-index: 10000000;
            pointer-events: all !important;
        `;

        const volumeButton = document.createElement('button');
        volumeButton.innerHTML = '🔊';
        volumeButton.style.cssText = `
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            margin-right: 8px;
            position: relative;
            z-index: 10000000;
            pointer-events: all !important;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Assemble the controls
        timeline.appendChild(progress);
        timelineContainer.appendChild(timeline);
        timelineContainer.appendChild(timeTooltip);

        controlsRow.appendChild(playButton);
        controlsRow.appendChild(timeDisplay);
        controlsRow.appendChild(volumeButton);

        container.appendChild(timelineContainer);
        container.appendChild(controlsRow);

        // Helper function for time formatting
        const formatTime = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        // Track dragging state
        let isDragging = false;

        // Show timeline preview on hover
        timelineContainer.addEventListener('mousemove', (e) => {
            const rect = timeline.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

            if (!isDragging) {
                timeTooltip.style.display = 'block';
                timeTooltip.style.left = `${pos * 100}%`;
                const previewTime = videoElement.duration * pos;
                timeTooltip.textContent = formatTime(previewTime);
            }
        });

        // Handle dragging
        const handleDrag = (e) => {
            if (!isDragging) return;

            const rect = timeline.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const newTime = videoElement.duration * pos;

            progress.style.width = `${pos * 100}%`;
            timeTooltip.style.left = `${pos * 100}%`;
            timeTooltip.textContent = formatTime(newTime);
            videoElement.currentTime = newTime;
        };

        // Start dragging
        timelineContainer.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isDragging = true;
            timeline.style.height = '5px';
            seekHandle.style.transform = 'translateY(-50%) scale(1)';
            handleDrag(e);

            // Add document-level event listeners
            document.addEventListener('mousemove', handleDrag);
            document.addEventListener('mouseup', () => {
                isDragging = false;
                timeline.style.height = '3px';
                seekHandle.style.transform = 'translateY(-50%) scale(0)';
                document.removeEventListener('mousemove', handleDrag);
            }, { once: true });
        });

        // Hide preview when leaving timeline
        timelineContainer.addEventListener('mouseleave', () => {
            if (!isDragging) {
                timeTooltip.style.display = 'none';
                timeline.style.height = '3px';
                seekHandle.style.transform = 'translateY(-50%) scale(0)';
            }
        });

        timelineContainer.addEventListener('mouseenter', () => {
            if (!isDragging) {
                timeline.style.height = '5px';
                seekHandle.style.transform = 'translateY(-50%) scale(1)';
            }
        });

        // Play/Pause handler
        playButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (videoElement.paused) {
                videoElement.play();
                playButton.innerHTML = '⏸️';
            } else {
                videoElement.pause();
                playButton.innerHTML = '⏵️';
            }
        });

        // Volume handler
        volumeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            videoElement.muted = !videoElement.muted;
            volumeButton.innerHTML = videoElement.muted ? '🔇' : '🔊';
        });

        // Update progress
        const updateProgress = () => {
            if (!isDragging) {
                const progress_value = (videoElement.currentTime / videoElement.duration) * 100;
                progress.style.width = `${progress_value}%`;
                timeDisplay.textContent = `${formatTime(videoElement.currentTime)} / ${formatTime(videoElement.duration)}`;
            }
        };

        videoElement.addEventListener('timeupdate', updateProgress);
        videoElement.addEventListener('loadedmetadata', updateProgress);
        videoElement.addEventListener('play', () => playButton.innerHTML = '⏸️');
        videoElement.addEventListener('pause', () => playButton.innerHTML = '⏵️');

        return container;
    };

    const addControlsToVideo = (videoElement) => {
        if (videoElement.dataset.customControls) return;
        videoElement.dataset.customControls = 'true';

        const videoContainer = videoElement.closest('div[class*="x5yr21d"][class*="x1uhb9sk"]');
        if (!videoContainer) return;

        const controlsWrapper = document.createElement('div');
        controlsWrapper.style.cssText = `
            width: 100%;
            position: relative;
            z-index: 9999999;
            pointer-events: all !important;
        `;

        const controls = createControls(videoElement);
        controlsWrapper.appendChild(controls);

        videoContainer.parentElement.insertBefore(controlsWrapper, videoContainer);
        videoContainer.style.position = 'relative';
        videoContainer.style.zIndex = '1';
    };

    // Observer to watch for new videos
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeName === 'VIDEO') {
                    addControlsToVideo(node);
                } else if (node.querySelectorAll) {
                    const videos = node.querySelectorAll('video');
                    videos.forEach(addControlsToVideo);
                }
            }
        }
    });

    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Process existing videos
    document.querySelectorAll('video').forEach(addControlsToVideo);
})();
