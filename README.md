# premium-recording

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Recording tools

While recording, a small annotation panel opens next to the screen. It can be dragged and docked left, right, top or bottom. It is hidden from the recording. The panel has the drawing tools, a Mic section (mute, level, AI noise removal) and a Cursor section.

The Cursor section controls what the video shows for the mouse:

- Highlight: a yellow halo that follows the pointer.
- Click effect: a ring that expands on every click. Clicks outside drawing mode need the optional `uiohook-napi` addon. If it cannot load, ripples appear only while a drawing tool is active.
- Show pointer: draws an arrow pointer. Turn it on if the cursor is missing in the video.

The app writes a log file to `userData/logs/premium-recording.log` (on Windows `%APPDATA%\premium-recording\logs\premium-recording.log`). The main window header shows the installed version and commit, which confirms which build is running.
