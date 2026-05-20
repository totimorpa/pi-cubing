# pi-cubing

A cstimer-style Rubik's Cube timer overlay for [Pi](https://pi.dev).

<img width="1428" height="846" alt="image" src="https://github.com/user-attachments/assets/7a0e5131-d252-4aaa-9919-490e80c872e5" />


## Features

- `/cubing` command opens a modal/overlay timer in the terminal.
- `Ctrl+Shift+C` opens the overlay quickly.
- 3x3 scramble generation.
- Spacebar timer flow:
  - hold `Space` for ~500ms until ready/green
  - release `Space` to start
  - press `Space` again to stop and save
- Stable, tabular stopwatch digits so centiseconds do not make the timer wiggle.
- Solve table with scrolling selection.
- Stats: mean, mo3, ao5, ao12, ao50, best ao5, best ao12.
- Per-solve rating: first, PB, great, good, ok, slow.
- Penalty editing: `+2`, `DNF`, delete.
- Local persistence on your laptop.

## Install

From GitHub:

```bash
pi install git:github.com/totimorpa/pi-cubing
```

Or while developing locally:

```bash
pi install /absolute/path/to/pi-cubing
# or from this repository's parent directory:
pi install ./pi-cubing
```

Then restart Pi or run:

```text
/reload
```

## Usage

Open the timer:

```text
/cubing
```

Controls:

| Key | Action |
| --- | --- |
| `Space` hold/release | Ready and start timer |
| `Space` while running | Stop and save solve |
| `Esc` | Reset visible timer to `0.00` |
| `Esc` twice | Close overlay |
| `↑` / `k` | Select newer solve |
| `↓` / `j` | Select older solve |
| `h` | Show help dialog with one shortcut per line |
| `i` | Show selected solve info |
| `d` / `Delete` / `Backspace` | Confirm delete selected solve |
| `y` / `n` | Confirm/cancel delete dialog |
| `p` | Toggle `+2` penalty |
| `x` | Toggle `DNF` |
| `n` / `r` | New scramble |
| `Shift+C` | Confirm clear all solves |

## Persistence

Solves are saved locally to:

```text
~/.pi/agent/cubing/solves.json
```

If you used the earlier `cube-timer` version, the extension will also read and migrate:

```text
~/.pi/agent/cube-timer/solves.json
```

## Development

Type-check:

```bash
npm install
npm run typecheck
```

Dry-run npm package contents:

```bash
npm run pack:dry
```

## Publishing to GitHub

```bash
git init
git add .
git commit -m "Initial pi-cubing package"
git branch -M main
git remote add origin git@github.com:totimorpa/pi-cubing.git
git push -u origin main
```

Then users can install it with:

```bash
pi install git:github.com/totimorpa/pi-cubing
```

## Security note

Pi extensions run with full local system permissions. Review any extension code before installing packages from others.
