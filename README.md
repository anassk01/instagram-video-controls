# Instagram Video Controls

A userscript that adds a clean, accessible control bar to Instagram videos: seek, volume, playback speed, and optional background playback. Your settings are remembered.

![version](https://img.shields.io/badge/version-4.0.0-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Seek bar** with current time / duration
- **Play / pause** that stays paused when you pause it
- **Volume slider and mute button**; your choice carries over to the next reel
- **Playback speed** from 0.25× to 2×
- **Background play (BG)** keeps a video playing when you switch tabs
- **Saved preferences** (volume, mute, speed, background play) across reloads
- **Keyboard and touch friendly**: sliders and the speed selector work with arrow keys, and controls are labelled for screen readers
- Works on reels, posts, and the feed, one control bar per video

The controls attach to the real `<video>` elements and do not depend on Instagram's generated class names, so they survive most UI updates.

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Create a new script and paste in the contents of [`instagram-video-controls.js`](instagram-video-controls.js), then save.
3. Open [instagram.com](https://www.instagram.com/) and reload.

Upgrading from v3? Replace the old script rather than running both. Saved preferences are kept.

## Usage

The control bar appears over the bottom of a video when you move the pointer, while the video is paused, or while a control has keyboard focus.

| Control | What it does |
| --- | --- |
| ▶ / Ⅱ | Play or pause |
| Seek bar | Drag or use arrow keys / Home / End to jump around |
| ◖ | Mute or unmute |
| Volume slider | Set volume (0 mutes) |
| Speed menu | 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2× |
| BG | Toggle background playback |

Instagram's initial mute state is left alone until you change it with the controls.

## Notes

- Background playback relies on the browser allowing hidden-tab media. If it refuses, the bar tells you to return to the tab.
- Settings live in `localStorage` under `igVideoPreferences`. If storage is blocked, controls still work for the current session.
- Instagram changes often. If something breaks, please open an issue with the page type (reel, post, feed) and your browser.

## Contributing

Issues and pull requests are welcome.

## License

[MIT](LICENSE)
