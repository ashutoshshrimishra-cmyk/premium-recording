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

## Capture modes, settings and shortcuts

- Capture modes: full screen (every monitor is listed), a single window, or a region of a screen. Window mode records the window without the annotation canvas.
- Settings (gear button in the header): frame rate, resolution, microphone, AI noise removal, save folder, countdown (off, 3 or 5 seconds), showing the folder after saving, cursor effect, and whether recording starts with drawing tools or in mouse mode.
- A countdown can be cancelled by clicking the button or pressing the start/stop shortcut. While a file is finalised the app shows a saving indicator, then the saved path.
- The last 10 recordings are listed with duration, size and date. Each can be opened or shown in its folder. Files that no longer exist are removed from the list.

Global shortcuts (work while another app is in front, and can be changed in Settings):

| Action                        | Default      |
| ----------------------------- | ------------ |
| Start / stop recording        | Ctrl+Shift+R |
| Pause / resume recording      | Ctrl+Shift+P |
| Toggle drawing and mouse mode | Ctrl+Shift+A |
| Save a screenshot (annotated) | Ctrl+Shift+S |

On macOS Ctrl is Cmd. If another app already uses a shortcut, Settings shows which one failed to register.

## Supported capture

- Sources: screens, single windows, and a region of a screen.
- Audio: microphone only. System audio is not captured.
- Frame rate options: 24, 30 and 60 FPS.

## Updates and signing

- There is no auto-update. The app never checks for or downloads new versions.
- The installer is not code signed, so Windows SmartScreen will show a warning. This is expected.
- To upgrade, download the new installer and run it over the existing install.

## Testing

Manual Windows checks are listed in [docs/WINDOWS_QA.md](docs/WINDOWS_QA.md).
