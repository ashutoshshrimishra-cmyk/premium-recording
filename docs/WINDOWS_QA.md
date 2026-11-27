# Windows manual QA checklist

Status: none of these checks have been run yet. Every Result cell below is empty on purpose. Fill in Pass or Fail, the build number, and notes when a check is executed.

Automated tests cover pure logic only. Capture, installer, and playback behavior needs a real Windows machine.

## Environment matrix

| Environment                             | Notes                                                                        | Result | Tester / date |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------ | ------------- |
| Windows 10 1809 / LTSC                  | Below build 19041: setContentProtection is unavailable (see platformCaps.ts) |        |               |
| Windows 10 2004 or newer (build 19041+) | setContentProtection works (see src/main/windows/platformCaps.ts)            |        |               |
| Windows 11                              |                                                                              |        |               |
| DPI 100 percent                         |                                                                              |        |               |
| DPI 125 percent                         |                                                                              |        |               |
| DPI 150 percent                         |                                                                              |        |               |
| DPI 200 percent                         |                                                                              |        |               |
| Single monitor                          |                                                                              |        |               |
| Multiple monitors                       |                                                                              |        |               |
| Multiple monitors with mixed DPI        | Check region and annotation alignment on each                                |        |               |

## Capture modes

| Check                        | Expected                                           | Result | Notes |
| ---------------------------- | -------------------------------------------------- | ------ | ----- |
| Screen capture, each monitor | Correct monitor, correct size, annotations in file |        |       |
| Window capture               | Window only, no annotation canvas                  |        |       |
| Region capture               | Region matches selection at each DPI               |        |       |

## Microphone and audio

| Check                                | Expected                                             | Result | Notes |
| ------------------------------------ | ---------------------------------------------------- | ------ | ----- |
| Default microphone                   | Voice is recorded                                    |        |       |
| Unplug microphone during recording   | Recording keeps data recorded so far, no crash       |        |       |
| Microphone permission denied         | Prompt offers retry, record without audio, or cancel |        |       |
| Retry after permission denied        | Works after permission is granted                    |        |       |
| Record without audio from the prompt | File has video only and plays                        |        |       |
| Noise removal on                     | Background noise reduced                             |        |       |
| Noise removal off                    | Raw microphone audio                                 |        |       |

## Recording behavior

| Check                           | Expected                                             | Result | Notes |
| ------------------------------- | ---------------------------------------------------- | ------ | ----- |
| Pause and resume                | Paused time is not in the file, audio stays in sync  |        |       |
| Short recording (a few seconds) | Valid file                                           |        |       |
| Long recording (30+ minutes)    | Valid file, memory stays stable, audio stays in sync |        |       |
| Low disk space                  | Clear error, partial data kept                       |        |       |
| Kill the app while recording    | .part file remains, recovered on next launch         |        |       |

## Playback

| Player               | Expected             | Result | Notes |
| -------------------- | -------------------- | ------ | ----- |
| Windows Media Player | Plays, seeking works |        |       |
| Movies & TV          | Plays, seeking works |        |       |
| VLC                  | Plays, seeking works |        |       |

## Installer

| Check                           | Expected                                         | Result | Notes |
| ------------------------------- | ------------------------------------------------ | ------ | ----- |
| Fresh install                   | Per-user install, shortcut created, app launches |        |       |
| SmartScreen warning             | Appears (installer is unsigned), can proceed     |        |       |
| Upgrade over a previous version | Settings and recent recordings kept              |        |       |
| Uninstall                       | App and shortcuts removed                        |        |       |
