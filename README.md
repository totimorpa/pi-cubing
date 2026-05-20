# pi-cubing

A cstimer-style Rubik's Cube timer overlay for [Pi](https://pi.dev), built for fast keyboard use inside the terminal.

- npm: https://www.npmjs.com/package/pi-cubing
- GitHub: https://github.com/totimorpa/pi-cubing
- Release notes: https://github.com/totimorpa/pi-cubing/releases

<img width="1428" height="846" alt="pi-cubing screenshot" src="https://github.com/user-attachments/assets/7a0e5131-d252-4aaa-9919-490e80c872e5" />

## What it does

`pi-cubing` adds a cubing timer overlay to Pi with:

- `/cubing` command
- `Ctrl+Shift+C` shortcut
- 3x3 scramble generation
- cstimer-like spacebar flow
- solve history with selection and scrolling
- averages and rolling stats
- solve info dialogs
- local persistence on disk

## Install

### From npm

```bash
pi install npm:pi-cubing
```

### From GitHub

```bash
pi install git:github.com/totimorpa/pi-cubing
```

### Local development install

```bash
pi install /absolute/path/to/pi-cubing
# or from this repository's parent directory:
pi install ./pi-cubing
```

Then restart Pi or run:

```text
/reload
```

## Open the timer

```text
/cubing
```

Or use:

```text
Ctrl+Shift+C
```

## Timer behavior

- Hold `Space` for about `500ms` until ready.
- Release `Space` to start.
- Press `Space` again to stop and save the solve.
- Press `Esc` once to reset the visible timer to `0.00`.
- Press `Esc` twice to close the overlay.

The large stopwatch digits are fixed-width/tabular so centiseconds do not make the display wiggle while solving.

## Controls

| Key | Action |
| --- | --- |
| `Space` hold/release | Ready and start timer |
| `Space` while running | Stop and save solve |
| `Esc` | Reset visible timer to `0.00` |
| `Esc` twice | Close overlay |
| `↑` / `k` | Select newer solve |
| `↓` / `j` | Select older solve |
| `h` | Show help dialog |
| `i` | Show selected solve info |
| `d` / `Delete` / `Backspace` | Confirm delete selected solve |
| `y` / `n` | Confirm/cancel delete or clear dialog |
| `p` | Toggle `+2` penalty |
| `x` | Toggle `DNF` |
| `n` / `r` | New scramble |
| `Shift+C` | Confirm clear all solves |

## Stats and averages

Shown in the UI:

- mean
- mo3
- ao5
- ao12
- ao50
- best ao5
- best ao12

Average rules follow standard cubing behavior:

- drop the best and worst solve in the window
- one `DNF` counts as the worst and is dropped
- two or more `DNF`s make the average `DNF`
- `+2` is included before computing averages

## Solve actions

Each solve can store:

- raw time
- `+2` penalty
- `DNF`
- scramble
- timestamp
- rating (`first`, `PB`, `great`, `good`, `ok`, `slow`)

Press `i` on a selected solve to open a dialog with:

- solve number
- displayed and raw time
- penalty
- rating
- date/time
- scramble

## Persistence

Solves are saved locally to:

```text
~/.pi/agent/cubing/solves.json
```

If you used the earlier `cube-timer` version, `pi-cubing` will also read and migrate:

```text
~/.pi/agent/cube-timer/solves.json
```

## Development

```bash
npm install
npm run typecheck
npm run pack:dry
```

## Releasing

### GitHub

```bash
git push
git push --tags
```

### npm

This repository includes a GitHub Actions workflow that publishes to npm using the `NPM_TOKEN` repository secret.

You can also publish manually:

```bash
npm publish --access public --otp=123456
```

## Security note

Pi extensions run with full local system permissions. Review any extension code before installing third-party packages.
