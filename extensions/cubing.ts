/**
 * Rubik's Cube timer extension for pi.
 *
 * Open with: /cubing
 * Space behavior mirrors cstimer: hold until green, release to start, press space to stop.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Penalty = 0 | 2000 | "DNF";

type Solve = {
	id: string;
	timeMs: number;
	penalty: Penalty;
	scramble: string;
	timestamp: number;
	rating: string;
};

type TimerPhase = "idle" | "holding" | "ready" | "running";

type SavedState = {
	solves: Solve[];
	currentScramble: string;
	selectedIndex?: number;
};

type Sticker = {
	pos: [number, number, number];
	normal: [number, number, number];
	color: FaceColor;
};

type FaceColor = "W" | "Y" | "G" | "B" | "R" | "O";

type CubeFaces = Record<"U" | "D" | "F" | "B" | "R" | "L", FaceColor[]>;

const SAVE_TYPE = "cubing-state";
const OLD_SAVE_TYPE = "cube-timer-state";
const DATA_FILE = join(homedir(), ".pi", "agent", "cubing", "solves.json");
const OLD_DATA_FILE = join(homedir(), ".pi", "agent", "cube-timer", "solves.json");
const INSPECTION_HOLD_MS = 500;
const TICK_MS = 37;
const SCRAMBLE_LENGTH = 21;

const RESET = "\x1b[0m";
const BOLD = (s: string) => `\x1b[1m${s}\x1b[22m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;
const BLUE = (s: string) => `\x1b[34m${s}${RESET}`;
const GREEN = (s: string) => `\x1b[32m${s}${RESET}`;
const RED = (s: string) => `\x1b[31m${s}${RESET}`;
const YELLOW = (s: string) => `\x1b[33m${s}${RESET}`;
const CYAN = (s: string) => `\x1b[36m${s}${RESET}`;
const MAGENTA = (s: string) => `\x1b[35m${s}${RESET}`;
const WHITE = (s: string) => `\x1b[97m${s}${RESET}`;

const stickerCell = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m  \x1b[0m`;

const COLOR_CELL: Record<FaceColor, string> = {
	W: stickerCell(245, 245, 245),
	Y: stickerCell(255, 239, 120),
	G: stickerCell(116, 220, 122),
	B: stickerCell(110, 150, 255),
	R: stickerCell(255, 112, 112),
	O: stickerCell(255, 186, 85),
};

const FACES = ["U", "D", "L", "R", "F", "B"] as const;
const AXIS: Record<(typeof FACES)[number], "x" | "y" | "z"> = {
	U: "y",
	D: "y",
	L: "x",
	R: "x",
	F: "z",
	B: "z",
};
const FACE_SIGN: Record<(typeof FACES)[number], 1 | -1> = {
	U: 1,
	D: -1,
	R: 1,
	L: -1,
	F: 1,
	B: -1,
};

const ANSI_RE = /\x1b\[[0-9;:]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z]|\x1b[=>]|\x1b./g;

const Key = {
	escape: "escape",
	space: "space",
	up: "up",
	down: "down",
	backspace: "backspace",
	delete: "delete",
} as const;

function visibleWidth(text: string): number {
	return Array.from(text.replace(ANSI_RE, "")).length;
}

function truncateToWidth(text: string, width: number, ellipsis = ""): string {
	if (width <= 0) return "";
	let out = "";
	let used = 0;
	for (let i = 0; i < text.length; ) {
		if (text[i] === "\x1b") {
			const match = text.slice(i).match(/^(?:\x1b\[[0-9;:]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z]|\x1b[=>]|\x1b.)/);
			if (match) {
				out += match[0];
				i += match[0].length;
				continue;
			}
		}
		const char = Array.from(text.slice(i))[0] ?? "";
		const charWidth = visibleWidth(char);
		if (used + charWidth > width) return out + ellipsis;
		out += char;
		used += charWidth;
		i += char.length;
	}
	return out;
}

function isKeyRelease(data: string): boolean {
	if (data.includes("\x1b[200~")) return false;
	return /:3(?:u|~|A|B|C|D|H|F)/.test(data);
}

function kittyCode(data: string, code: number): boolean {
	return new RegExp(`\\x1b\\[${code}(?:;\\d+)?(?::[123])?u`).test(data);
}

function matchesKey(data: string, key: string): boolean {
	switch (key) {
		case Key.space:
			return data === " " || kittyCode(data, 32);
		case Key.escape:
			return data === "\x1b" || kittyCode(data, 27);
		case Key.up:
			return data === "\x1b[A" || data === "\x1bOA" || /\x1b\[[0-9;:]*A$/.test(data);
		case Key.down:
			return data === "\x1b[B" || data === "\x1bOB" || /\x1b\[[0-9;:]*B$/.test(data);
		case Key.backspace:
			return data === "\x7f" || data === "\b" || kittyCode(data, 127);
		case Key.delete:
			return data === "\x1b[3~" || /\x1b\[3;?[0-9:]*~$/.test(data);
		default:
			return false;
	}
}

function fit(line: string, width: number): string {
	const clipped = truncateToWidth(line, Math.max(0, width), "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function center(line: string, width: number): string {
	const clipped = truncateToWidth(line, Math.max(0, width), "");
	const pad = Math.max(0, width - visibleWidth(clipped));
	const left = Math.floor(pad / 2);
	return " ".repeat(left) + clipped + " ".repeat(pad - left);
}

function boxTop(width: number, title = ""): string {
	if (!title) return DIM(`╭${"─".repeat(Math.max(0, width - 2))}╮`);
	const label = ` ${title} `;
	const inner = Math.max(0, width - 2);
	const labelWidth = visibleWidth(label);
	const rest = Math.max(0, inner - labelWidth);
	return DIM("╭") + DIM("─".repeat(Math.floor(rest / 2))) + label + DIM("─".repeat(Math.ceil(rest / 2))) + DIM("╮");
}

function boxBottom(width: number): string {
	return DIM(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

function boxLine(content: string, width: number): string {
	return DIM("│") + " " + fit(content, Math.max(0, width - 4)) + " " + DIM("│");
}

function wrapWords(text: string, width: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (visibleWidth(next) > width && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [""];
}

function formatTime(ms: number): string {
	const totalCentis = Math.floor(ms / 10);
	const centis = totalCentis % 100;
	const totalSeconds = Math.floor(totalCentis / 100);
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
	return `${seconds}.${String(centis).padStart(2, "0")}`;
}

function displayedSolveTime(solve: Solve): string {
	if (solve.penalty === "DNF") return "DNF";
	const base = solve.timeMs + solve.penalty;
	return `${formatTime(base)}${solve.penalty === 2000 ? "+" : ""}`;
}

function effectiveMs(solve: Solve): number | null {
	if (solve.penalty === "DNF") return null;
	return solve.timeMs + solve.penalty;
}

function mean(values: number[]): number | null {
	if (!values.length) return null;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function meanOfLast(solves: Solve[], count: number): number | null {
	const valid = solves.slice(-count).map(effectiveMs).filter((v): v is number => v !== null);
	if (valid.length < count) return null;
	return mean(valid);
}

function averageWindow(window: Solve[]): number | null {
	const values = window.map(effectiveMs);
	const dnfs = values.filter((v) => v === null).length;
	if (dnfs >= 2) return null;

	const sortable = values.map((value) => (value === null ? Number.POSITIVE_INFINITY : value));
	const best = Math.min(...sortable);
	const worst = Math.max(...sortable);
	let droppedBest = false;
	let droppedWorst = false;
	const kept: number[] = [];

	for (const value of sortable) {
		if (!droppedBest && value === best) {
			droppedBest = true;
			continue;
		}
		if (!droppedWorst && value === worst) {
			droppedWorst = true;
			continue;
		}
		if (Number.isFinite(value)) kept.push(value);
	}
	return mean(kept);
}

function ao(solves: Solve[], count: number): number | null | undefined {
	if (solves.length < count) return undefined;
	return averageWindow(solves.slice(-count));
}

function bestAo(solves: Solve[], count: number): number | null | undefined {
	if (solves.length < count) return undefined;
	let best: number | null = null;
	for (let i = 0; i <= solves.length - count; i++) {
		const avg = averageWindow(solves.slice(i, i + count));
		if (avg !== null && (best === null || avg < best)) best = avg;
	}
	return best;
}

function formatMaybeAverage(value: number | null | undefined): string {
	if (value === undefined) return "—";
	if (value === null) return "DNF";
	return formatTime(value);
}

function generateScramble(length = SCRAMBLE_LENGTH): string {
	const modifiers = ["", "'", "2"];
	const axisForFace: Record<string, string> = { U: "y", D: "y", L: "x", R: "x", F: "z", B: "z" };
	const moves: string[] = [];
	while (moves.length < length) {
		const face = FACES[Math.floor(Math.random() * FACES.length)];
		const previous = moves[moves.length - 1]?.[0];
		const beforePrevious = moves[moves.length - 2]?.[0];
		if (face === previous) continue;
		if (previous && beforePrevious && axisForFace[face] === axisForFace[previous] && axisForFace[face] === axisForFace[beforePrevious]) continue;
		moves.push(face + modifiers[Math.floor(Math.random() * modifiers.length)]);
	}
	return moves.join(" ");
}

function ratingFor(ms: number, previous: Solve[]): string {
	const valid = previous.map(effectiveMs).filter((v): v is number => v !== null);
	if (valid.length === 0) return "first";
	const best = Math.min(...valid);
	const avg = mean(valid) ?? ms;
	const recentAo12 = ao(previous, 12);
	const baseline = typeof recentAo12 === "number" ? recentAo12 : avg;
	if (ms < best) return "PB";
	if (ms <= baseline * 0.93) return "great";
	if (ms <= baseline) return "good";
	if (ms >= baseline * 1.18) return "slow";
	return "ok";
}

function isSavedState(value: unknown): value is SavedState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<SavedState>;
	return Array.isArray(state.solves) && typeof state.currentScramble === "string";
}

function lastSolveTimestamp(state: SavedState | undefined): number {
	if (!state?.solves.length) return 0;
	return Math.max(...state.solves.map((solve) => solve.timestamp || 0));
}

function pickLatestState(...states: Array<SavedState | undefined>): SavedState | undefined {
	return states
		.filter((state): state is SavedState => Boolean(state))
		.sort((a, b) => lastSolveTimestamp(b) - lastSolveTimestamp(a) || b.solves.length - a.solves.length)[0];
}

async function readSavedStateFile(path: string): Promise<SavedState | undefined> {
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (isSavedState(parsed)) return parsed;
	} catch (error) {
		if ((error as { code?: string }).code !== "ENOENT") {
			console.warn(`[cubing] Could not read ${path}:`, error);
		}
	}
	return undefined;
}

async function loadStateFromDisk(): Promise<SavedState | undefined> {
	const current = await readSavedStateFile(DATA_FILE);
	if (current) return current;
	const old = await readSavedStateFile(OLD_DATA_FILE);
	if (old) saveStateToDisk(old);
	return old;
}

let saveQueue: Promise<void> = Promise.resolve();

function saveStateToDisk(state: SavedState): void {
	const snapshot: SavedState = {
		solves: [...state.solves],
		currentScramble: state.currentScramble,
		selectedIndex: state.selectedIndex,
	};
	saveQueue = saveQueue
		.then(async () => {
			await mkdir(dirname(DATA_FILE), { recursive: true });
			const temp = `${DATA_FILE}.tmp`;
			await writeFile(temp, JSON.stringify(snapshot, null, 2), "utf8");
			await rename(temp, DATA_FILE);
		})
		.catch((error) => {
			console.warn(`[cubing] Could not save ${DATA_FILE}:`, error);
		});
}

function makeSolvedStickers(): Sticker[] {
	const stickers: Sticker[] = [];
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			stickers.push({ pos: [col - 1, 1, row - 1], normal: [0, 1, 0], color: "W" });
			stickers.push({ pos: [col - 1, -1, 1 - row], normal: [0, -1, 0], color: "Y" });
			stickers.push({ pos: [col - 1, 1 - row, 1], normal: [0, 0, 1], color: "G" });
			stickers.push({ pos: [1 - col, 1 - row, -1], normal: [0, 0, -1], color: "B" });
			stickers.push({ pos: [1, 1 - row, 1 - col], normal: [1, 0, 0], color: "R" });
			stickers.push({ pos: [-1, 1 - row, col - 1], normal: [-1, 0, 0], color: "O" });
		}
	}
	return stickers;
}

function rotateVector([x, y, z]: [number, number, number], axis: "x" | "y" | "z", quarterTurns: number): [number, number, number] {
	let turns = ((quarterTurns % 4) + 4) % 4;
	let vector: [number, number, number] = [x, y, z];
	while (turns-- > 0) {
		const [vx, vy, vz] = vector;
		if (axis === "x") vector = [vx, -vz, vy];
		if (axis === "y") vector = [vz, vy, -vx];
		if (axis === "z") vector = [-vy, vx, vz];
	}
	return vector;
}

function applyMove(stickers: Sticker[], token: string): void {
	const face = token[0] as (typeof FACES)[number];
	const axis = AXIS[face];
	const sign = FACE_SIGN[face];
	const suffix = token.slice(1);
	const baseTurns = suffix === "2" ? 2 : suffix === "'" ? 1 : -1;
	const turns = baseTurns * sign;

	for (const sticker of stickers) {
		const coordinate = axis === "x" ? sticker.pos[0] : axis === "y" ? sticker.pos[1] : sticker.pos[2];
		if (coordinate === sign) {
			sticker.pos = rotateVector(sticker.pos, axis, turns);
			sticker.normal = rotateVector(sticker.normal, axis, turns);
		}
	}
}

function cubeFacesForScramble(scramble: string): CubeFaces {
	const stickers = makeSolvedStickers();
	for (const token of scramble.split(/\s+/).filter(Boolean)) applyMove(stickers, token);

	const faces: CubeFaces = {
		U: Array(9).fill("W"),
		D: Array(9).fill("Y"),
		F: Array(9).fill("G"),
		B: Array(9).fill("B"),
		R: Array(9).fill("R"),
		L: Array(9).fill("O"),
	};

	for (const sticker of stickers) {
		const [x, y, z] = sticker.pos;
		const [nx, ny, nz] = sticker.normal;
		let face: keyof CubeFaces;
		let row: number;
		let col: number;
		if (ny === 1) {
			face = "U";
			row = z + 1;
			col = x + 1;
		} else if (ny === -1) {
			face = "D";
			row = 1 - z;
			col = x + 1;
		} else if (nz === 1) {
			face = "F";
			row = 1 - y;
			col = x + 1;
		} else if (nz === -1) {
			face = "B";
			row = 1 - y;
			col = 1 - x;
		} else if (nx === 1) {
			face = "R";
			row = 1 - y;
			col = 1 - z;
		} else {
			face = "L";
			row = 1 - y;
			col = z + 1;
		}
		faces[face][row * 3 + col] = sticker.color;
	}
	return faces;
}

function faceRows(face: FaceColor[]): string[] {
	return [0, 1, 2].map((row) => face.slice(row * 3, row * 3 + 3).map((c) => COLOR_CELL[c]).join(""));
}

function renderCubeNet(scramble: string): string[] {
	const faces = cubeFacesForScramble(scramble);
	const u = faceRows(faces.U);
	const d = faceRows(faces.D);
	const f = faceRows(faces.F);
	const b = faceRows(faces.B);
	const r = faceRows(faces.R);
	const l = faceRows(faces.L);
	const gap = " ";
	const indent = "       ";
	const lines: string[] = [];
	for (const row of u) lines.push(indent + row);
	for (let i = 0; i < 3; i++) lines.push(l[i] + gap + f[i] + gap + r[i] + gap + b[i]);
	for (const row of d) lines.push(indent + row);
	return lines;
}

const BIG_DIGITS: Record<string, string[]> = {
	"0": [" ███ ", "█   █", "█   █", "█   █", " ███ "],
	"1": ["  █  ", " ██  ", "  █  ", "  █  ", " ███ "],
	"2": [" ███ ", "█   █", "   █ ", "  █  ", "█████"],
	"3": ["████ ", "    █", " ███ ", "    █", "████ "],
	"4": ["█  █ ", "█  █ ", "█████", "   █ ", "   █ "],
	"5": ["█████", "█    ", "████ ", "    █", "████ "],
	"6": [" ███ ", "█    ", "████ ", "█   █", " ███ "],
	"7": ["█████", "   █ ", "  █  ", " █   ", "█    "],
	"8": [" ███ ", "█   █", " ███ ", "█   █", " ███ "],
	"9": [" ███ ", "█   █", " ████", "    █", " ███ "],
	".": ["     ", "     ", "     ", "     ", "  █  "],
	":": ["     ", "  █  ", "     ", "  █  ", "     "],
	"+": ["     ", "  █  ", " ███ ", "  █  ", "     "],
	"D": ["████ ", "█   █", "█   █", "█   █", "████ "],
	"N": ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
	"F": ["█████", "█    ", "████ ", "█    ", "█    "],
	" ": ["     ", "     ", "     ", "     ", "     "],
};

function formatTimerTime(ms: number): string {
	const totalCentis = Math.floor(ms / 10);
	const centis = totalCentis % 100;
	const totalSeconds = Math.floor(totalCentis / 100);
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
	return `${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function renderBig(text: string, width: number, color: (s: string) => string): string[] {
	const rows = ["", "", "", "", ""];
	for (const char of text) {
		const glyph = BIG_DIGITS[char] ?? BIG_DIGITS[" "];
		for (let i = 0; i < rows.length; i++) {
			// Keep every character in a fixed 5-column slot and never trim rows.
			// This makes the stopwatch tabular, so centiseconds changing does not
			// recenter individual rows and make the whole timer appear to wiggle.
			rows[i] += glyph[i].padEnd(5, " ") + " ";
		}
	}
	return rows.map((row) => center(color(row), width));
}

type DialogState =
	| { kind: "help" }
	| { kind: "info"; solve: Solve; index: number }
	| { kind: "delete"; solve: Solve; index: number }
	| { kind: "clear"; count: number };

class CubeTimerComponent {
	wantsKeyRelease = true;

	private solves: Solve[];
	private currentScramble: string;
	private selectedIndex: number;
	private phase: TimerPhase = "idle";
	private holdStart = 0;
	private runStart = 0;
	private displayMs = 0;
	private lastStoppedMs = 0;
	private interval: ReturnType<typeof setInterval> | null = null;
	private suppressRelease = false;
	private cachedWidth = 0;
	private cachedVersion = -1;
	private cachedLines: string[] = [];
	private version = 0;
	private lastEscAt = 0;
	private dialog: DialogState | null = null;

	constructor(
		private tui: { requestRender: () => void; terminal?: { rows: number } },
		private onClose: () => void,
		private onSave: (state: SavedState) => void,
		saved?: SavedState,
	) {
		this.solves = saved?.solves ?? [];
		this.currentScramble = saved?.currentScramble || generateScramble();
		this.selectedIndex = Math.min(saved?.selectedIndex ?? this.solves.length - 1, this.solves.length - 1);
		if (this.selectedIndex < 0 && this.solves.length > 0) this.selectedIndex = this.solves.length - 1;
	}

	handleInput(data: string): void {
		const released = isKeyRelease(data);

		if (this.dialog) {
			if (!released) this.handleDialogInput(data);
			return;
		}

		const space = matchesKey(data, Key.space) || data === " ";

		if (space) {
			this.lastEscAt = 0;
			this.handleSpace(released);
			return;
		}

		if (!released && matchesKey(data, Key.escape)) {
			this.handleEscape();
			return;
		}

		if (this.phase === "running") return;

		if (!released && (data === "h" || data === "H")) {
			this.dialog = { kind: "help" };
			this.changed(false);
		} else if (!released && (data === "i" || data === "I")) {
			this.showSelectedInfo();
		} else if (!released && (matchesKey(data, Key.down) || data === "j" || data === "J")) {
			this.selectOlder();
		} else if (!released && (matchesKey(data, Key.up) || data === "k" || data === "K")) {
			this.selectNewer();
		} else if (!released && (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete) || data === "d" || data === "D")) {
			this.confirmDeleteSelected();
		} else if (!released && (data === "p" || data === "P")) {
			this.togglePlusTwo();
		} else if (!released && (data === "x" || data === "X")) {
			this.toggleDnf();
		} else if (!released && (data === "n" || data === "N" || data === "r" || data === "R")) {
			this.currentScramble = generateScramble();
			this.changed(true);
		} else if (!released && data === "C") {
			this.confirmClearSolves();
		}
	}

	invalidate(): void {
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedVersion === this.version) return this.cachedLines;

		const innerWidth = Math.max(30, width - 2);
		const targetContentHeight = this.getTargetContentHeight();

		if (this.phase === "running") {
			const content = this.applyDialog(this.buildTimerOnly(innerWidth, targetContentHeight).map((line) => fit(line, innerWidth)), innerWidth);
			this.cachedLines = this.withOuterBorder(content, width);
			this.cachedWidth = width;
			this.cachedVersion = this.version;
			return this.cachedLines;
		}

		const safeWidth = Math.max(60, innerWidth);
		const leftWidth = safeWidth >= 104 ? 50 : Math.min(50, Math.max(42, Math.floor(safeWidth * 0.45)));
		const gap = " ";
		const rightWidth = Math.max(30, safeWidth - leftWidth - visibleWidth(gap));

		const totalRows = targetContentHeight;
		const left = this.buildLeft(leftWidth, totalRows);
		const right = this.buildRight(rightWidth, totalRows);
		const lines: string[] = [];
		for (let i = 0; i < totalRows; i++) {
			lines.push(fit(left[i] ?? "", leftWidth) + gap + fit(right[i] ?? "", rightWidth));
		}

		const content = this.applyDialog(lines.map((line) => fit(line, innerWidth)), innerWidth);
		this.cachedLines = this.withOuterBorder(content, width);
		this.cachedWidth = width;
		this.cachedVersion = this.version;
		return this.cachedLines;
	}

	dispose(): void {
		this.stopTicker();
	}

	private withOuterBorder(lines: string[], width: number): string[] {
		const innerWidth = Math.max(0, width - 2);
		const border = (s: string) => `\x1b[38;2;20;20;20m\x1b[48;2;255;255;255m${s}\x1b[0m`;
		const top = border(`┏${"━".repeat(innerWidth)}┓`);
		const bottom = border(`┗${"━".repeat(innerWidth)}┛`);
		return [top, ...lines.map((line) => border("┃") + fit(line, innerWidth) + border("┃")), bottom];
	}

	private getTargetContentHeight(): number {
		const rows = this.tui.terminal?.rows;
		if (!rows || rows < 10) return 26;
		// `render()` only receives width, not overlay height. Leave room for Pi's editor/footer.
		return Math.max(18, Math.min(28, rows - 14));
	}

	private applyDialog(lines: string[], width: number): string[] {
		if (!this.dialog) return lines;
		const dialogLines = this.buildDialog(width);
		const start = Math.max(0, Math.floor((lines.length - dialogLines.length) / 2));
		const next = [...lines];
		for (let i = 0; i < dialogLines.length && start + i < next.length; i++) {
			next[start + i] = center(dialogLines[i], width);
		}
		return next;
	}

	private buildDialog(width: number): string[] {
		const dialogWidth = Math.max(34, Math.min(76, width - 4));
		const bodyWidth = Math.max(10, dialogWidth - 4);
		const lines: string[] = [];
		const title = this.dialog?.kind === "help" ? "Help" : this.dialog?.kind === "info" ? "Solve info" : this.dialog?.kind === "clear" ? "Clear all solves?" : "Delete solve?";
		lines.push(boxTop(dialogWidth, MAGENTA(BOLD(title))));

		if (this.dialog?.kind === "help") {
			const key = (text: string) => CYAN(BOLD(text.padEnd(12, " ")));
			const desc = (text: string) => WHITE(text);
			const helpRows: Array<[string, string]> = [
				["Space", "hold, then release to start"],
				["Space", "stop and save while running"],
				["↑ / k", "select newer solve"],
				["↓ / j", "select older solve"],
				["h", "show this help"],
				["i", "show selected solve info"],
				["d", "delete selected solve"],
				["p", "toggle +2 penalty"],
				["x", "toggle DNF"],
				["n / r", "new scramble"],
				["Shift+C", "clear solves"],
				["Esc", "reset timer / close dialog"],
				["Esc Esc", "close overlay"],
			];
			for (const [shortcut, description] of helpRows) {
				lines.push(boxLine(`${key(shortcut)} ${desc(description)}`, dialogWidth));
			}
		} else if (this.dialog?.kind === "info") {
			const solve = this.dialog.solve;
			const date = new Date(solve.timestamp).toLocaleString();
			for (const line of [
				`Solve #${this.dialog.index + 1}`,
				`Time: ${displayedSolveTime(solve)}   raw: ${formatTime(solve.timeMs)}`,
				`Penalty: ${solve.penalty === 0 ? "none" : solve.penalty}`,
				`Rating: ${solve.rating}`,
				`Date: ${date}`,
				"Scramble:",
			]) {
				lines.push(boxLine(line, dialogWidth));
			}
			for (const line of wrapWords(solve.scramble, bodyWidth)) lines.push(boxLine(line, dialogWidth));
			lines.push(boxLine("Esc closes this dialog", dialogWidth));
		} else if (this.dialog?.kind === "delete") {
			const solve = this.dialog.solve;
			lines.push(boxLine(`Delete solve #${this.dialog.index + 1}?`, dialogWidth));
			lines.push(boxLine(`Time: ${displayedSolveTime(solve)}`, dialogWidth));
			lines.push(boxLine("", dialogWidth));
			lines.push(boxLine(`${GREEN("y")} yes, delete     ${RED("n")} no, keep`, dialogWidth));
		} else if (this.dialog?.kind === "clear") {
			lines.push(boxLine(`Clear all ${this.dialog.count} solve(s)?`, dialogWidth));
			lines.push(boxLine("This cannot be undone.", dialogWidth));
			lines.push(boxLine("", dialogWidth));
			lines.push(boxLine(`${GREEN("y")} yes, clear all     ${RED("n")} no, keep`, dialogWidth));
		}

		lines.push(boxBottom(dialogWidth));
		return lines;
	}

	private handleDialogInput(data: string): void {
		if (!this.dialog) return;
		if (this.dialog.kind === "delete" || this.dialog.kind === "clear") {
			if (data === "y" || data === "Y") {
				if (this.dialog.kind === "delete") this.deleteSelectedConfirmed();
				else this.clearSolvesConfirmed();
				this.dialog = null;
				this.changed(true);
				return;
			}
			if (data === "n" || data === "N" || matchesKey(data, Key.escape)) {
				this.dialog = null;
				this.changed(false);
				return;
			}
			return;
		}

		if (matchesKey(data, Key.escape) || data === "h" || data === "H" || data === "i" || data === "I") {
			this.dialog = null;
			this.changed(false);
		}
	}

	private handleEscape(): void {
		const now = Date.now();
		if (now - this.lastEscAt < 1400) {
			this.dispose();
			this.save();
			this.onClose();
			return;
		}
		this.lastEscAt = now;
		this.phase = "idle";
		this.displayMs = 0;
		this.lastStoppedMs = 0;
		this.suppressRelease = false;
		this.stopTicker();
		this.changed(false);
	}

	private handleSpace(released: boolean): void {
		if (this.suppressRelease && released) {
			this.suppressRelease = false;
			return;
		}

		if (this.phase === "running") {
			if (!released) this.stopSolve();
			return;
		}

		if (!released) {
			if (this.phase === "idle") {
				this.phase = "holding";
				this.holdStart = Date.now();
				this.startTicker();
				this.changed(false);
			}
			return;
		}

		if (this.phase === "ready") {
			this.startSolve();
		} else if (this.phase === "holding") {
			this.phase = "idle";
			this.stopTicker();
			this.changed(false);
		}
	}

	private startTicker(): void {
		if (this.interval) return;
		this.interval = setInterval(() => {
			const now = Date.now();
			if (this.phase === "holding" && now - this.holdStart >= INSPECTION_HOLD_MS) this.phase = "ready";
			if (this.phase === "running") this.displayMs = now - this.runStart;
			this.changed(false);
		}, TICK_MS);
	}

	private stopTicker(): void {
		if (this.interval) clearInterval(this.interval);
		this.interval = null;
	}

	private startSolve(): void {
		this.phase = "running";
		this.runStart = Date.now();
		this.displayMs = 0;
		this.startTicker();
		this.changed(false);
	}

	private stopSolve(): void {
		const elapsed = Math.max(1, Date.now() - this.runStart);
		this.displayMs = elapsed;
		this.lastStoppedMs = elapsed;
		const solve: Solve = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			timeMs: elapsed,
			penalty: 0,
			scramble: this.currentScramble,
			timestamp: Date.now(),
			rating: ratingFor(elapsed, this.solves),
		};
		this.solves.push(solve);
		this.selectedIndex = this.solves.length - 1;
		this.currentScramble = generateScramble();
		this.phase = "idle";
		this.stopTicker();
		this.suppressRelease = true;
		this.changed(true);
	}

	private selectedSolve(): Solve | undefined {
		return this.selectedIndex >= 0 ? this.solves[this.selectedIndex] : undefined;
	}

	private selectOlder(): void {
		if (this.solves.length === 0) return;
		if (this.selectedIndex < 0) this.selectedIndex = this.solves.length - 1;
		else this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		this.changed(true);
	}

	private selectNewer(): void {
		if (this.solves.length === 0) return;
		if (this.selectedIndex < 0) this.selectedIndex = this.solves.length - 1;
		else this.selectedIndex = Math.min(this.solves.length - 1, this.selectedIndex + 1);
		this.changed(true);
	}

	private showSelectedInfo(): void {
		const solve = this.selectedSolve();
		if (!solve) return;
		this.dialog = { kind: "info", solve, index: this.selectedIndex };
		this.changed(false);
	}

	private confirmDeleteSelected(): void {
		const solve = this.selectedSolve();
		if (!solve) return;
		this.dialog = { kind: "delete", solve, index: this.selectedIndex };
		this.changed(false);
	}

	private deleteSelectedConfirmed(): void {
		if (this.selectedIndex < 0 || this.solves.length === 0) return;
		this.solves.splice(this.selectedIndex, 1);
		this.selectedIndex = Math.min(this.selectedIndex, this.solves.length - 1);
	}

	private confirmClearSolves(): void {
		if (this.solves.length === 0) return;
		this.dialog = { kind: "clear", count: this.solves.length };
		this.changed(false);
	}

	private clearSolvesConfirmed(): void {
		this.solves = [];
		this.selectedIndex = -1;
		this.lastStoppedMs = 0;
	}

	private togglePlusTwo(): void {
		const solve = this.selectedSolve();
		if (!solve) return;
		solve.penalty = solve.penalty === 2000 ? 0 : 2000;
		this.changed(true);
	}

	private toggleDnf(): void {
		const solve = this.selectedSolve();
		if (!solve) return;
		solve.penalty = solve.penalty === "DNF" ? 0 : "DNF";
		this.changed(true);
	}

	private changed(persist: boolean): void {
		this.version++;
		if (persist) this.save();
		this.tui.requestRender();
	}

	private save(): void {
		this.onSave({ solves: this.solves, currentScramble: this.currentScramble, selectedIndex: this.selectedIndex });
	}

	private buildLeft(width: number, maxHeight: number): string[] {
		const lines: string[] = [];
		const valid = this.solves.map(effectiveMs).filter((v): v is number => v !== null);
		const best = valid.length ? Math.min(...valid) : undefined;
		const allMean = mean(valid);
		const current = this.solves[this.solves.length - 1];

		const sessionLines = [
			boxTop(width, BLUE(BOLD("Session"))),
			boxLine(`solves: ${BOLD(String(this.solves.length))}   mean: ${BLUE(formatMaybeAverage(allMean ?? undefined))}`, width),
			boxLine(`current: ${current ? BLUE(displayedSolveTime(current)) : "—"}   best: ${best ? GREEN(formatTime(best)) : "—"}`, width),
			boxLine(`mo3: ${BLUE(formatMaybeAverage(meanOfLast(this.solves, 3) ?? undefined))}   ao5: ${BLUE(formatMaybeAverage(ao(this.solves, 5)))}`, width),
			boxLine(`ao12: ${BLUE(formatMaybeAverage(ao(this.solves, 12)))}   ao50: ${BLUE(formatMaybeAverage(ao(this.solves, 50)))}`, width),
			boxLine(`best ao5: ${GREEN(formatMaybeAverage(bestAo(this.solves, 5)))}   best ao12: ${GREEN(formatMaybeAverage(bestAo(this.solves, 12)))}`, width),
			boxBottom(width),
		];

		const cubeLines = [boxTop(width, BLUE(BOLD("Cube"))), ...renderCubeNet(this.currentScramble).map((row) => boxLine(row, width)), boxBottom(width)];
		const controlsLines =
			maxHeight >= 36
				? [
						boxTop(width, BLUE(BOLD("Controls"))),
						boxLine("Space: hold → green → release", width),
						boxLine("Space while running: stop/save", width),
						boxLine("↑/↓ select  h help  i info", width),
						boxLine("d delete  p +2  x DNF", width),
						boxLine("n new scramble  Esc reset/close", width),
						boxBottom(width),
					]
				: [];

		const timeRowCount = Math.max(1, maxHeight - sessionLines.length - cubeLines.length - controlsLines.length - 3);
		const timeLines: string[] = [boxTop(width, BLUE(BOLD("Times"))), boxLine(BOLD("#   time       rating   ao5    ao12"), width)];
		const rows = this.getVisibleSolveRows(timeRowCount);
		if (rows.length === 0) {
			timeLines.push(boxLine(DIM("No solves yet. Hold space."), width));
		} else {
			for (const { solve, index } of rows) {
				const marker = index === this.selectedIndex ? BLUE("›") : " ";
				const n = String(index + 1).padStart(3, " ");
				const time = displayedSolveTime(solve).padStart(8, " ");
				const rating = solve.rating.padEnd(7, " ").slice(0, 7);
				const ao5 = formatMaybeAverage(index + 1 >= 5 ? averageWindow(this.solves.slice(index - 4, index + 1)) : undefined).padStart(6, " ");
				const ao12 = formatMaybeAverage(index + 1 >= 12 ? averageWindow(this.solves.slice(index - 11, index + 1)) : undefined).padStart(6, " ");
				const coloredTime = solve.penalty === "DNF" ? RED(time) : solve.rating === "PB" ? GREEN(time) : BLUE(time);
				timeLines.push(boxLine(`${marker}${n} ${coloredTime} ${rating} ${ao5} ${ao12}`, width));
			}
		}
		timeLines.push(boxBottom(width));

		lines.push(...sessionLines, ...timeLines, ...controlsLines, ...cubeLines);
		while (lines.length < maxHeight) lines.push(fit("", width));
		return lines.slice(0, maxHeight);
	}

	private getVisibleSolveRows(count: number): Array<{ solve: Solve; index: number }> {
		if (count <= 0 || this.solves.length === 0) return [];
		const selected = this.selectedIndex >= 0 ? this.selectedIndex : this.solves.length - 1;
		const newest = this.solves.length - 1;
		let topIndex: number;

		if (selected >= newest - count + 1) {
			// Normal view: newest solves at the top.
			topIndex = newest;
		} else {
			// Scrolled view: keep selected solve visible and roughly centered.
			topIndex = Math.min(newest, selected + Math.floor(count / 2));
		}

		const bottomIndex = Math.max(0, topIndex - count + 1);
		const rows: Array<{ solve: Solve; index: number }> = [];
		for (let index = topIndex; index >= bottomIndex; index--) {
			rows.push({ solve: this.solves[index], index });
		}
		return rows;
	}

	private buildRight(width: number, height: number): string[] {
		const lines: string[] = [];
		lines.push(boxTop(width, MAGENTA(BOLD("Scramble"))));
		for (const line of wrapWords(this.currentScramble, Math.max(10, width - 4))) lines.push(boxLine(WHITE(line), width));
		lines.push(boxBottom(width));

		const timerHeight = Math.max(12, height - lines.length);
		lines.push(...this.buildTimerBox(width, timerHeight));
		while (lines.length < height) lines.push(fit("", width));
		return lines.slice(0, height);
	}

	private buildTimerBox(width: number, height: number): string[] {
		const timeText = this.lastStoppedMs ? formatTimerTime(this.lastStoppedMs) : "00.00";
		const color = this.phase === "ready" ? GREEN : this.phase === "holding" ? YELLOW : WHITE;
		const a5 = formatMaybeAverage(ao(this.solves, 5));
		const a12 = formatMaybeAverage(ao(this.solves, 12));
		const last = this.solves[this.solves.length - 1];
		const core = [
			center(this.phaseHelp(), width - 4),
			"",
			...renderBig(timeText, Math.max(20, width - 4), color),
			"",
			center(`${BLUE("ao5:")} ${BOLD(a5)}        ${BLUE("ao12:")} ${BOLD(a12)}`, width - 4),
			center(last ? `last: ${displayedSolveTime(last)}  rating: ${last.rating}` : "first solve is ready", width - 4),
			center(DIM("Esc resets to 0.00 • Esc Esc closes"), width - 4),
		];

		const innerHeight = Math.max(1, height - 2);
		const topPad = Math.max(0, Math.floor((innerHeight - core.length) / 2));
		const bottomPad = Math.max(0, innerHeight - core.length - topPad);
		const lines = [boxTop(width, this.phaseTitle())];
		for (let i = 0; i < topPad; i++) lines.push(boxLine("", width));
		for (const line of core.slice(0, innerHeight)) lines.push(boxLine(line, width));
		for (let i = 0; i < bottomPad; i++) lines.push(boxLine("", width));
		lines.push(boxBottom(width));
		return lines.slice(0, height);
	}

	private buildTimerOnly(width: number, height: number): string[] {
		const boxWidth = Math.max(32, Math.min(width, 120));
		const boxHeight = Math.max(12, height);
		const core = [...renderBig(formatTimerTime(this.displayMs), Math.max(20, boxWidth - 4), BLUE), "", center("SPACE", boxWidth - 4)];
		const innerHeight = Math.max(1, boxHeight - 2);
		const topPad = Math.max(0, Math.floor((innerHeight - core.length) / 2));
		const bottomPad = Math.max(0, innerHeight - core.length - topPad);
		const lines = [boxTop(boxWidth, BLUE(BOLD("RUNNING")))];
		for (let i = 0; i < topPad; i++) lines.push(boxLine("", boxWidth));
		for (const line of core.slice(0, innerHeight)) lines.push(boxLine(line, boxWidth));
		for (let i = 0; i < bottomPad; i++) lines.push(boxLine("", boxWidth));
		lines.push(boxBottom(boxWidth));
		return lines.slice(0, boxHeight).map((line) => center(line, width));
	}

	private phaseTitle(): string {
		if (this.phase === "ready") return GREEN(BOLD("READY - release space"));
		if (this.phase === "holding") return YELLOW(BOLD("KEEP HOLDING"));
		if (this.phase === "running") return BLUE(BOLD("RUNNING"));
		return MAGENTA(BOLD("Stopwatch"));
	}

	private phaseHelp(): string {
		if (this.phase === "ready") return "release SPACE";
		if (this.phase === "holding") {
			const held = Date.now() - this.holdStart;
			const pct = Math.min(1, held / INSPECTION_HOLD_MS);
			const barWidth = 20;
			const filled = Math.round(pct * barWidth);
			return `hold SPACE ${GREEN("█".repeat(filled))}${DIM("░".repeat(barWidth - filled))}`;
		}
		if (this.phase === "running") return "SPACE";
		return "hold SPACE";
	}
}

export default function (pi: ExtensionAPI) {
	let overlayOpen = false;

	async function openCubing(ctx: any): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("/cubing requires interactive mode", "error");
			return;
		}
		if (overlayOpen) {
			ctx.ui.notify("Cubing timer is already open", "info");
			return;
		}

		let sessionSaved: SavedState | undefined;
		const entries = ctx.sessionManager.getBranch();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && (entry.customType === SAVE_TYPE || entry.customType === OLD_SAVE_TYPE) && isSavedState(entry.data)) {
				sessionSaved = entry.data;
				break;
			}
		}
		const diskSaved = await loadStateFromDisk();
		const saved = pickLatestState(diskSaved, sessionSaved);
		if (sessionSaved && !diskSaved) saveStateToDisk(sessionSaved);

		overlayOpen = true;
		try {
			await ctx.ui.custom(
				(_tui: { requestRender: () => void }, _theme: unknown, _kb: unknown, done: (value: undefined) => void) => {
					return new CubeTimerComponent(
						_tui,
						() => done(undefined),
						(state) => {
							pi.appendEntry(SAVE_TYPE, state);
							saveStateToDisk(state);
						},
						saved,
					);
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "95%",
						maxHeight: "95%",
						margin: 1,
					},
				},
			);
		} finally {
			overlayOpen = false;
		}
	}

	pi.registerCommand("cubing", {
		description: "Open a cstimer-style cubing timer overlay with scrambles, averages, ratings, and stopwatch controls",
		handler: async (_args, ctx) => {
			await openCubing(ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+c", {
		description: "Open cubing timer overlay",
		handler: async (ctx) => {
			void openCubing(ctx);
		},
	});
}
