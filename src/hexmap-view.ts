import { ItemView, Menu, Notice, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_TUNING, sanitizeHexText, type HexcrawlSettings } from './data';
import { HexNameModal } from './name-modal';
import { TerrainModal } from './terrain-modal';
import {
	DEFAULT_TERRAIN_ID,
	getTerrainImage,
	normalizeTileId,
	parseTileId,
	terrainTileById,
	type TerrainTile,
} from './tiles';

export const HEXMAP_VIEW_TYPE = 'vpahexcrawl-map';

// Paint order. The canvas draws in call order, so lower layers paint first.
// Numbered in steps of 10 with gaps reserved: rivers (13) and roads (16)
// will slot between terrain and features without renumbering anything.
export const LAYER_TERRAIN = 10;
export const LAYER_BORDER = 11;
export const LAYER_RIVER = 13;
export const LAYER_ROAD = 16;
export const LAYER_FEATURE = 20;
export const LAYER_TOKEN = 30;
export const LAYER_TEXT = 40;
export const LAYER_ERROR = 50;

export interface AxialCoord {
	q: number;
	r: number;
	txt?: string;
	t?: string;
	f?: string;
	road?: boolean;
	river?: boolean;
	bornAt?: number;
}

export interface HexmapViewOptions {
	initialHexes: ReadonlyArray<AxialCoord>;
	initialPlayerAt: AxialCoord | null;
	onHexesAdded: (coords: ReadonlyArray<AxialCoord>) => void;
	onHexesRemoved: (coords: ReadonlyArray<AxialCoord>) => void;
	onHexTextSet: (coord: AxialCoord, text: string) => void;
	onPlayerSet: (coord: AxialCoord) => void;
	getTerrainTiles: () => ReadonlyArray<TerrainTile>;
	onTerrainSet: (coord: AxialCoord, terrainId: string) => void;
	getFeatureTiles: () => ReadonlyArray<TerrainTile>;
	onFeatureSet: (coord: AxialCoord, featureId: string) => void;
	refreshTiles?: () => Promise<void>;
	getTokenImageUrl: () => string | null;
	onRoadSet: (coord: AxialCoord, hasRoad: boolean) => void;
	onRiverSet: (coord: AxialCoord, hasRiver: boolean) => void;
	getTuning: () => HexcrawlSettings;
}

interface WorldPoint {
	x: number;
	y: number;
}

const HEX_SIZE = 48;

const TOKEN_OFFSET_X = HEX_SIZE * 0.46;
const TOKEN_OFFSET_Y = -HEX_SIZE * 0.42;
const TOKEN_GRAB_PADDING = 8;

const NEIGHBOR_OFFSETS: ReadonlyArray<{ dq: number; dr: number }> = [
	{ dq: 1, dr: 0 },
	{ dq: 1, dr: -1 },
	{ dq: 0, dr: -1 },
	{ dq: -1, dr: 0 },
	{ dq: -1, dr: 1 },
	{ dq: 0, dr: 1 },
];

// Edge index follows corner angles 30, 90, 150, 210, 270, 330 for pointy-top hexes.
// Each entry maps a neighbor direction to the shared edge corners.
const GHOST_EDGES: ReadonlyArray<{ dq: number; dr: number; c0: number; c1: number }> = [
	{ dq: 1, dr: 0, c0: 5, c1: 0 },
	{ dq: 0, dr: 1, c0: 0, c1: 1 },
	{ dq: -1, dr: 1, c0: 1, c1: 2 },
	{ dq: -1, dr: 0, c0: 2, c1: 3 },
	{ dq: 0, dr: -1, c0: 3, c1: 4 },
	{ dq: 1, dr: -1, c0: 4, c1: 5 },
];

function hexCorner(cx: number, cy: number, index: number): WorldPoint {
	const angle = (Math.PI / 180) * (30 + 60 * index);
	return {
		x: cx + HEX_SIZE * Math.cos(angle),
		y: cy + HEX_SIZE * Math.sin(angle),
	};
}

function hexKey(q: number, r: number): string {
	return `${q},${r}`;
}

function axialToPixel(q: number, r: number): WorldPoint {
	return {
		x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
		y: HEX_SIZE * 1.5 * r,
	};
}

function cubeRound(q: number, r: number): AxialCoord {
	const s = -q - r;
	let rq = Math.round(q);
	let rr = Math.round(r);
	const rs = Math.round(s);
	const dq = Math.abs(rq - q);
	const dr = Math.abs(rr - r);
	const ds = Math.abs(rs - s);
	if (dq > dr && dq > ds) {
		rq = -rr - rs;
	} else if (dr > ds) {
		rr = -rq - rs;
	}
	return { q: rq, r: rr };
}

function pixelToAxial(x: number, y: number): AxialCoord {
	const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / HEX_SIZE;
	const r = ((2 / 3) * y) / HEX_SIZE;
	return cubeRound(q, r);
}

export class HexmapView extends ItemView {
	private wrapper: HTMLDivElement | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private hexes = new Map<string, AxialCoord>();
	private cameraX = 0;
	private cameraY = 0;
	private zoom = 1;
	private dragging = false;
	private lastClientX = 0;
	private lastClientY = 0;
	private dragDistance = 0;
	private rafId: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private viewOptions: HexmapViewOptions | null = null;
	private playerAt: AxialCoord | null = null;
	private tokenDragging = false;
	private tokenPointerId: number | null = null;
	private tokenDragPos: WorldPoint | null = null;
	private panPointerId: number | null = null;
	private activePointers = new Map<number, { x: number; y: number }>();
	private pinchDistance: number | null = null;
	private suppressClick = false;

	constructor(leaf: WorkspaceLeaf, options?: HexmapViewOptions) {
		super(leaf);
		if (options !== undefined) {
			this.viewOptions = options;
		}
	}

	getViewType(): string {
		return HEXMAP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Hex map';
	}

	getIcon(): string {
		return 'hexagon';
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		const wrapper = this.contentEl.createDiv({ cls: 'vpahexcrawl-map-container' });
		this.wrapper = wrapper;
		const canvas = wrapper.createEl('canvas', { cls: 'vpahexcrawl-map-canvas' });
		canvas.setAttr('tabindex', '0');
		canvas.setAttr('role', 'application');
		canvas.setAttr('aria-label', 'Hex map canvas. Use arrow keys to pan, plus and minus to zoom. Drag the player token with mouse or touch to move it.');
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.hexes.clear();
		const seeds = this.viewOptions?.initialHexes ?? [{ q: 0, r: 0 }];
		for (const seed of seeds) {
			const cleaned = typeof seed.txt === 'string' ? sanitizeHexText(seed.txt) : '';
			const entry: AxialCoord = { q: seed.q, r: seed.r };
			if (cleaned.length > 0) {
				entry.txt = cleaned;
			}
			entry.t = typeof seed.t === 'string' && seed.t.length > 0 ? normalizeTileId(seed.t) : DEFAULT_TERRAIN_ID;
			if (entry.t.length === 0) {
				entry.t = DEFAULT_TERRAIN_ID;
			}
			if (typeof seed.f === 'string' && seed.f.length > 0) {
				const normalizedFeature = normalizeTileId(seed.f);
				if (normalizedFeature.length > 0) {
					entry.f = normalizedFeature;
				}
			}
			if (seed.road === true) {
				entry.road = true;
			}
			if (seed.river === true) {
				entry.river = true;
			}
			this.hexes.set(hexKey(seed.q, seed.r), entry);
		}
		if (this.hexes.size === 0) {
			this.hexes.set(hexKey(0, 0), { q: 0, r: 0 });
		}
		const startPlayer = this.viewOptions?.initialPlayerAt ?? null;
		if (startPlayer !== null && this.hexes.has(hexKey(startPlayer.q, startPlayer.r))) {
			this.playerAt = { q: startPlayer.q, r: startPlayer.r };
		} else {
			this.playerAt = null;
		}
		this.tokenDragging = false;
		this.tokenPointerId = null;
		this.tokenDragPos = null;
		this.panPointerId = null;
		this.activePointers.clear();
		this.pinchDistance = null;
		const origin = axialToPixel(0, 0);
		this.cameraX = origin.x;
		this.cameraY = origin.y;
		this.zoom = 1;

		this.registerDomEvent(canvas, 'pointerdown', (evt: PointerEvent) => {
			if (evt.button !== 0) {
				return;
			}
			if (evt.isPrimary === false && evt.pointerType !== 'touch' && evt.pointerType !== 'pen') {
				return;
			}
			if (!this.dragging && !this.tokenDragging && this.pinchDistance === null) {
				this.activePointers.clear();
			}
			this.suppressClick = false;
			this.activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
			if (this.activePointers.size >= 2) {
				this.cancelPointerGestures();
				this.pinchDistance = this.currentPinchDistance();
				return;
			}
			const pressWorld = this.screenToWorld(evt.clientX, evt.clientY);
			if (pressWorld !== null && this.isOnToken(pressWorld.x, pressWorld.y)) {
				this.tokenDragging = true;
				this.tokenPointerId = evt.pointerId;
				this.tokenDragPos = pressWorld;
				try {
					canvas.setPointerCapture(evt.pointerId);
				} catch {
					// Pointer capture is best effort only.
				}
				this.scheduleRedraw();
				return;
			}
			this.dragging = true;
			this.panPointerId = evt.pointerId;
			this.lastClientX = evt.clientX;
			this.lastClientY = evt.clientY;
			this.dragDistance = 0;
		});
		this.registerDomEvent(canvas, 'pointermove', (evt: PointerEvent) => {
			if (!this.activePointers.has(evt.pointerId)) {
				return;
			}
			this.activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
			if (this.pinchDistance !== null) {
				if (this.activePointers.size >= 2) {
					const points = [...this.activePointers.values()];
					const first = points[0];
					const second = points[1];
					if (first !== undefined && second !== undefined) {
						const next = Math.hypot(first.x - second.x, first.y - second.y);
						if (next > 0 && this.pinchDistance > 0) {
							this.zoomAtPoint(
								(first.x + second.x) / 2,
								(first.y + second.y) / 2,
								next / this.pinchDistance,
							);
						}
						if (next > 0) {
							this.pinchDistance = next;
						}
					}
				}
				return;
			}
			if (this.tokenDragging) {
				if (evt.pointerId !== this.tokenPointerId) {
					return;
				}
				const dragWorld = this.screenToWorld(evt.clientX, evt.clientY);
				if (dragWorld !== null) {
					this.tokenDragPos = dragWorld;
					this.scheduleRedraw();
				}
				return;
			}
			if (!this.dragging || evt.pointerId !== this.panPointerId) {
				return;
			}
			const dx = evt.clientX - this.lastClientX;
			const dy = evt.clientY - this.lastClientY;
			this.dragDistance += Math.abs(dx) + Math.abs(dy);
			if (this.dragDistance >= 6) {
				this.suppressClick = false;
			}
			this.lastClientX = evt.clientX;
			this.lastClientY = evt.clientY;
			this.cameraX -= dx / this.zoom;
			this.cameraY -= dy / this.zoom;
			this.scheduleRedraw();
		});
		this.registerDomEvent(canvas, 'pointerup', (evt: PointerEvent) => {
			if (evt.pointerType === 'mouse' && evt.button !== 0) {
				return;
			}
			if (this.releasePointer(evt.pointerId)) {
				return;
			}
			if (this.tokenDragging) {
				if (evt.pointerId !== this.tokenPointerId) {
					return;
				}
				this.tokenDragging = false;
				this.tokenPointerId = null;
				this.finishTokenDrop(evt.clientX, evt.clientY);
				return;
			}
			const wasDragging = this.dragging;
			const clickAllowed = !this.suppressClick;
			this.dragging = false;
			this.panPointerId = null;
			this.suppressClick = false;
			if (wasDragging && clickAllowed && this.dragDistance < 6) {
				this.handleClick(evt.clientX, evt.clientY);
			}
			this.dragDistance = 0;
		});
		this.registerDomEvent(canvas, 'pointercancel', (evt: PointerEvent) => {
			if (this.releasePointer(evt.pointerId)) {
				return;
			}
			if (this.tokenDragging && evt.pointerId === this.tokenPointerId) {
				this.tokenDragging = false;
				this.tokenPointerId = null;
				this.tokenDragPos = null;
				this.scheduleRedraw();
				return;
			}
			if (evt.pointerId === this.panPointerId) {
				this.dragging = false;
				this.panPointerId = null;
				this.dragDistance = 0;
			}
		});
		this.registerDomEvent(
			canvas,
			'wheel',
			(evt: WheelEvent) => {
				evt.preventDefault();
				this.zoomAtPoint(evt.clientX, evt.clientY, evt.deltaY < 0 ? 1.1 : 1 / 1.1);
			},
			{ passive: false },
		);
		this.registerDomEvent(canvas, 'keydown', (evt: KeyboardEvent) => {
			this.handleKey(evt);
		});
		this.registerDomEvent(canvas, 'contextmenu', (evt: MouseEvent) => {
			evt.preventDefault();
			this.showContextMenu(evt.clientX, evt.clientY, evt);
		});
		this.registerDomEvent(canvas, 'dblclick', (evt: MouseEvent) => {
			const world = this.screenToWorld(evt.clientX, evt.clientY);
			if (world === null) {
				return;
			}
			const axial = pixelToAxial(world.x, world.y);
			const existing = this.hexes.get(hexKey(axial.q, axial.r));
			if (existing !== undefined) {
				if (typeof existing.bornAt === 'number' && Date.now() - existing.bornAt < 1500) {
					delete existing.bornAt;
					this.openTerrainPicker(axial.q, axial.r);
					return;
				}
				const currentText = typeof existing.txt === 'string' ? existing.txt : '';
				const modal = new HexNameModal(this.app, {
					title: currentText.length > 0 ? 'Edit hex name' : 'Set hex name',
					initialText: currentText,
					onSave: (text: string) => {
						this.setHexText(axial.q, axial.r, text);
					},
				});
				modal.open();
				return;
			}
			if (!this.isValidGhost(axial.q, axial.r)) {
				return;
			}
			if (this.createHexAt(axial.q, axial.r)) {
				const created = this.hexes.get(hexKey(axial.q, axial.r));
				if (created !== undefined) {
					delete created.bornAt;
				}
				this.openTerrainPicker(axial.q, axial.r);
			}
		});

		const observer = new ResizeObserver(() => {
			this.resizeCanvas();
			this.scheduleRedraw();
		});
		observer.observe(wrapper);
		this.resizeObserver = observer;

		this.resizeCanvas();
		this.scheduleRedraw();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		if (this.rafId !== null) {
			window.cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.resizeObserver !== null) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		this.hexes.clear();
		this.playerAt = null;
		this.tokenDragging = false;
		this.tokenPointerId = null;
		this.tokenDragPos = null;
		this.panPointerId = null;
		this.activePointers.clear();
		this.pinchDistance = null;
		this.wrapper = null;
		this.canvas = null;
		this.ctx = null;
		this.dragging = false;
		this.contentEl.empty();
		return Promise.resolve();
	}

	resetMapToDefault(): void {
		this.hexes.clear();
		this.hexes.set(hexKey(0, 0), { q: 0, r: 0, t: DEFAULT_TERRAIN_ID });
		this.playerAt = { q: 0, r: 0 };
		this.tokenDragging = false;
		this.tokenPointerId = null;
		this.tokenDragPos = null;
		this.panPointerId = null;
		this.activePointers.clear();
		this.pinchDistance = null;
		const origin = axialToPixel(0, 0);
		this.cameraX = origin.x;
		this.cameraY = origin.y;
		this.zoom = 1;
		this.scheduleRedraw();
	}

	fillTestArea(radius = 13): void {
		const added: AxialCoord[] = [];
		for (let dq = -radius; dq <= radius; dq++) {
			for (let dr = -radius; dr <= radius; dr++) {
				const s = -dq - dr;
				const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(s));
				if (dist <= radius) {
					const k = hexKey(dq, dr);
					if (!this.hexes.has(k)) {
						const coord: AxialCoord = { q: dq, r: dr, t: DEFAULT_TERRAIN_ID };
						this.hexes.set(k, coord);
						added.push(coord);
					}
				}
			}
		}
		if (added.length > 0) {
			this.viewOptions?.onHexesAdded(added);
		}
		this.scheduleRedraw();
	}

	private cancelPointerGestures(): void {
		this.dragging = false;
		this.panPointerId = null;
		this.tokenDragging = false;
		this.tokenPointerId = null;
		this.tokenDragPos = null;
		this.dragDistance = 0;
		this.scheduleRedraw();
	}

	private currentPinchDistance(): number | null {
		const points = [...this.activePointers.values()];
		const first = points[0];
		const second = points[1];
		if (first === undefined || second === undefined) {
			return null;
		}
		const distance = Math.hypot(first.x - second.x, first.y - second.y);
		return distance > 0 ? distance : null;
	}

	private releasePointer(pointerId: number): boolean {
		this.activePointers.delete(pointerId);
		if (this.pinchDistance === null) {
			return false;
		}
		const baseline = this.currentPinchDistance();
		if (baseline !== null) {
			this.pinchDistance = baseline;
			return true;
		}
		this.pinchDistance = null;
		const remaining = [...this.activePointers.entries()];
		const last = remaining[remaining.length - 1];
		this.suppressClick = true;
		if (last !== undefined) {
			this.dragging = true;
			this.panPointerId = last[0];
			this.lastClientX = last[1].x;
			this.lastClientY = last[1].y;
			this.dragDistance = 0;
		} else {
			this.dragging = false;
			this.panPointerId = null;
		}
		return false;
	}

	private handleKey(evt: KeyboardEvent): void {
		const pan = 48 / this.zoom;
		let handled = true;
		if (evt.key === 'ArrowUp') {
			this.cameraY -= pan;
		} else if (evt.key === 'ArrowDown') {
			this.cameraY += pan;
		} else if (evt.key === 'ArrowLeft') {
			this.cameraX -= pan;
		} else if (evt.key === 'ArrowRight') {
			this.cameraX += pan;
		} else if (evt.key === '+' || evt.key === '=') {
			this.zoomBy(1.15);
		} else if (evt.key === '-' || evt.key === '_') {
			this.zoomBy(1 / 1.15);
		} else if (evt.key === 'Home') {
			const origin = axialToPixel(0, 0);
			this.cameraX = origin.x;
			this.cameraY = origin.y;
			this.zoom = 1;
		} else {
			handled = false;
		}
		if (handled) {
			evt.preventDefault();
			this.scheduleRedraw();
		}
	}

	private zoomBy(factor: number): void {
		const next = Math.min(4, Math.max(0.25, this.zoom * factor));
		this.zoom = next;
	}

	private zoomAtPoint(clientX: number, clientY: number, factor: number): void {
		const before = this.screenToWorld(clientX, clientY);
		if (before === null) {
			return;
		}
		const next = Math.min(4, Math.max(0.25, this.zoom * factor));
		if (next === this.zoom) {
			return;
		}
		this.zoom = next;
		const after = this.screenToWorld(clientX, clientY);
		if (after === null) {
			return;
		}
		this.cameraX += before.x - after.x;
		this.cameraY += before.y - after.y;
		this.scheduleRedraw();
	}

	private handleClick(clientX: number, clientY: number): void {
		const world = this.screenToWorld(clientX, clientY);
		if (world === null) {
			return;
		}
		const axial = pixelToAxial(world.x, world.y);
		this.createHexAt(axial.q, axial.r);
	}

	private createHexAt(q: number, r: number): boolean {
		const k = hexKey(q, r);
		if (this.hexes.has(k)) {
			return false;
		}
		if (!this.isValidGhost(q, r)) {
			return false;
		}
		const coord: AxialCoord = { q, r, t: DEFAULT_TERRAIN_ID, bornAt: Date.now() };
		this.hexes.set(k, coord);
		this.viewOptions?.onHexesAdded([coord]);
		this.scheduleRedraw();
		return true;
	}

	private openTerrainPicker(q: number, r: number): void {
		const existing = this.hexes.get(hexKey(q, r));
		if (existing === undefined) {
			return;
		}
		const currentId =
			typeof existing.t === 'string' && existing.t.length > 0
				? normalizeTileId(existing.t)
				: DEFAULT_TERRAIN_ID;
		const cached = this.viewOptions?.getTerrainTiles() ?? [];
		void (async (): Promise<void> => {
			try {
				await this.viewOptions?.refreshTiles?.();
			} catch {
				// Refresh is best effort; fall back to cached tiles.
			}
			const fresh = [...(this.viewOptions?.getTerrainTiles() ?? cached)];
			if (fresh.length === 0) {
				return;
			}
			const parsed = parseTileId(currentId.length > 0 ? currentId : DEFAULT_TERRAIN_ID);
			const modal = new TerrainModal(this.app, {
				title: 'Set terrain',
				tiles: fresh,
				currentId,
				initialSetId: parsed?.setId,
				onPick: (terrainId: string) => {
					this.setTerrainAt(q, r, terrainId);
				},
			});
			modal.open();
		})();
	}

	private removeHexAt(q: number, r: number): boolean {
		if (this.hexes.size <= 1) {
			return false;
		}
		const k = hexKey(q, r);
		const existing = this.hexes.get(k);
		if (existing === undefined) {
			return false;
		}
		this.hexes.delete(k);
		this.viewOptions?.onHexesRemoved([{ q, r }]);
		if (this.playerAt !== null && this.playerAt.q === q && this.playerAt.r === r) {
			const fallback = this.findTokenFallback();
			if (fallback !== null) {
				this.playerAt = fallback;
				this.viewOptions?.onPlayerSet(fallback);
			}
		}
		this.scheduleRedraw();
		return true;
	}

	private findTokenFallback(): AxialCoord | null {
		if (this.hexes.has(hexKey(0, 0))) {
			return { q: 0, r: 0 };
		}
		const first = this.hexes.values().next();
		if (!first.done) {
			return { q: first.value.q, r: first.value.r };
		}
		return null;
	}

	private tokenDiameter(): number {
		const tuning = this.viewOptions?.getTuning() ?? DEFAULT_TUNING;
		return (HEX_SIZE * tuning.tokenSize) / 100;
	}

	private tokenCenterFor(q: number, r: number): WorldPoint {
		const pt = axialToPixel(q, r);
		return { x: pt.x + TOKEN_OFFSET_X, y: pt.y + TOKEN_OFFSET_Y };
	}

	private isOnToken(x: number, y: number): boolean {
		if (this.playerAt === null) {
			return false;
		}
		const center = this.tokenCenterFor(this.playerAt.q, this.playerAt.r);
		const dx = x - center.x;
		const dy = y - center.y;
		const grab = this.tokenDiameter() / 2 + TOKEN_GRAB_PADDING;
		return dx * dx + dy * dy <= grab * grab;
	}

	private finishTokenDrop(clientX: number, clientY: number): void {
		const world = this.screenToWorld(clientX, clientY);
		this.tokenDragPos = null;
		if (world === null) {
			this.scheduleRedraw();
			return;
		}
		const axial = pixelToAxial(world.x, world.y);
		if (!this.hexes.has(hexKey(axial.q, axial.r))) {
			new Notice('Token must land on an open hex.');
			this.scheduleRedraw();
			return;
		}
		this.playerAt = { q: axial.q, r: axial.r };
		this.viewOptions?.onPlayerSet({ q: axial.q, r: axial.r });
		this.scheduleRedraw();
	}

	private drawPlayerToken(target: AxialCoord | null): void {
		const ctx = this.ctx;
		if (ctx === null) {
			return;
		}
		const accent = this.getCssVariable('--interactive-accent', '#7c3aed');
		const edge = this.getCssVariable('--text-normal', '#ffffff');
		if (target !== null) {
			const pt = axialToPixel(target.q, target.r);
			this.traceHexPath(pt.x, pt.y);
			ctx.lineWidth = 2.5;
			ctx.strokeStyle = accent;
			ctx.stroke();
		}
		let cx = 0;
		let cy = 0;
		let lifted = false;
		if (this.tokenDragging && this.tokenDragPos !== null) {
			cx = this.tokenDragPos.x;
			cy = this.tokenDragPos.y;
			lifted = true;
		} else if (this.playerAt !== null) {
			const center = this.tokenCenterFor(this.playerAt.q, this.playerAt.r);
			cx = center.x;
			cy = center.y;
		} else {
			return;
		}
		const radius = (this.tokenDiameter() / 2) * (lifted ? 1.1 : 1);
		const tokenUrl = this.viewOptions?.getTokenImageUrl() ?? null;
		const tokenImg = tokenUrl === null ? null : getTerrainImage(tokenUrl, () => this.scheduleRedraw());
		ctx.save();
		ctx.shadowColor = lifted ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.85)';
		ctx.shadowBlur = lifted ? 26 : 18;
		ctx.shadowOffsetY = (lifted ? 24 : 10) / this.zoom;
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.fillStyle = accent;
		ctx.fill();
		ctx.restore();
		if (tokenImg !== null) {
			ctx.save();
			ctx.beginPath();
			ctx.arc(cx, cy, radius, 0, Math.PI * 2);
			ctx.clip();
			const cover = Math.max(
				(radius * 2) / tokenImg.naturalWidth,
				(radius * 2) / tokenImg.naturalHeight,
			);
			const drawWidth = tokenImg.naturalWidth * cover;
			const drawHeight = tokenImg.naturalHeight * cover;
			ctx.drawImage(tokenImg, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
			ctx.restore();
		}
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.lineWidth = 2;
		ctx.strokeStyle = edge;
		ctx.stroke();
	}

	private setHexText(q: number, r: number, text: string): boolean {
		const k = hexKey(q, r);
		const existing = this.hexes.get(k);
		if (existing === undefined) {
			return false;
		}
		const cleaned = sanitizeHexText(text);
		const entry: AxialCoord = { q, r };
		if (typeof existing.t === 'string' && existing.t.length > 0) {
			entry.t = existing.t;
		}
		if (typeof existing.f === 'string' && existing.f.length > 0) {
			entry.f = existing.f;
		}
		if (existing.road === true) {
			entry.road = true;
		}
		if (existing.river === true) {
			entry.river = true;
		}
		if (cleaned.length > 0) {
			entry.txt = cleaned;
			this.hexes.set(k, entry);
		} else {
			this.hexes.set(k, entry);
		}
		this.viewOptions?.onHexTextSet({ q, r }, cleaned);
		this.scheduleRedraw();
		return true;
	}

	private setTerrainAt(q: number, r: number, terrainId: string): boolean {
		const k = hexKey(q, r);
		const existing = this.hexes.get(k);
		if (existing === undefined) {
			return false;
		}
		const normalized = normalizeTileId(terrainId);
		if (normalized.length === 0) {
			return false;
		}
		if (existing.t === normalized) {
			return false;
		}
		const entry: AxialCoord = { q, r, t: normalized };
		if (typeof existing.txt === 'string' && existing.txt.length > 0) {
			entry.txt = existing.txt;
		}
		if (typeof existing.f === 'string' && existing.f.length > 0) {
			entry.f = existing.f;
		}
		if (existing.road === true) {
			entry.road = true;
		}
		if (existing.river === true) {
			entry.river = true;
		}
		this.hexes.set(k, entry);
		this.viewOptions?.onTerrainSet({ q, r }, normalized);
		this.scheduleRedraw();
		return true;
	}

	private setFeatureAt(q: number, r: number, featureId: string): boolean {
		const k = hexKey(q, r);
		const existing = this.hexes.get(k);
		if (existing === undefined) {
			return false;
		}
		const normalized = featureId.length === 0 ? '' : normalizeTileId(featureId);
		if (featureId.length > 0 && normalized.length === 0) {
			return false;
		}
		const current = typeof existing.f === 'string' ? existing.f : '';
		if (current === normalized) {
			return false;
		}
		const entry: AxialCoord = { q, r };
		if (typeof existing.t === 'string' && existing.t.length > 0) {
			entry.t = existing.t;
		}
		if (typeof existing.txt === 'string' && existing.txt.length > 0) {
			entry.txt = existing.txt;
		}
		if (normalized.length > 0) {
			entry.f = normalized;
		}
		if (existing.road === true) {
			entry.road = true;
		}
		if (existing.river === true) {
			entry.river = true;
		}
		this.hexes.set(k, entry);
		this.viewOptions?.onFeatureSet({ q, r }, normalized);
		this.scheduleRedraw();
		return true;
	}

	private toggleRoadAt(q: number, r: number): boolean {
		const k = hexKey(q, r);
		const existing = this.hexes.get(k);
		if (existing === undefined) {
			return false;
		}
		const hasRoad = existing.road === true;
		const entry: AxialCoord = { q, r };
		if (typeof existing.t === 'string' && existing.t.length > 0) {
			entry.t = existing.t;
		}
		if (typeof existing.txt === 'string' && existing.txt.length > 0) {
			entry.txt = existing.txt;
		}
		if (typeof existing.f === 'string' && existing.f.length > 0) {
			entry.f = existing.f;
		}
		if (!hasRoad) {
			entry.road = true;
		}
		if (existing.river === true) {
			entry.river = true;
		}
		this.hexes.set(k, entry);
		this.viewOptions?.onRoadSet({ q, r }, !hasRoad);
		this.scheduleRedraw();
		return true;
	}

	private toggleRiverAt(q: number, r: number): boolean {
		const k = hexKey(q, r);
		const existing = this.hexes.get(k);
		if (existing === undefined) {
			return false;
		}
		const hasRiver = existing.river === true;
		const entry: AxialCoord = { q, r };
		if (typeof existing.t === 'string' && existing.t.length > 0) {
			entry.t = existing.t;
		}
		if (typeof existing.txt === 'string' && existing.txt.length > 0) {
			entry.txt = existing.txt;
		}
		if (typeof existing.f === 'string' && existing.f.length > 0) {
			entry.f = existing.f;
		}
		if (existing.road === true) {
			entry.road = true;
		}
		if (!hasRiver) {
			entry.river = true;
		}
		this.hexes.set(k, entry);
		this.viewOptions?.onRiverSet({ q, r }, !hasRiver);
		this.scheduleRedraw();
		return true;
	}

	redraw(): void {
		this.scheduleRedraw();
	}

	private showContextMenu(clientX: number, clientY: number, evt: MouseEvent): void {
		const world = this.screenToWorld(clientX, clientY);
		if (world === null) {
			return;
		}
		const axial = pixelToAxial(world.x, world.y);
		const k = hexKey(axial.q, axial.r);
		const menu = new Menu();
		if (this.hexes.has(k)) {
			const targetQ = axial.q;
			const targetR = axial.r;
			const existing = this.hexes.get(k);
			const currentText = typeof existing?.txt === 'string' ? existing.txt : '';
			menu.addItem((item) =>
				item.setTitle(currentText.length > 0 ? 'Edit name' : 'Set name').onClick(() => {
					const modal = new HexNameModal(this.app, {
						title: 'Set hex name',
						initialText: currentText,
						onSave: (text: string) => {
							this.setHexText(targetQ, targetR, text);
						},
					});
					modal.open();
				}),
			);
			if (currentText.length > 0) {
				menu.addItem((item) =>
					item.setTitle('Clear name').onClick(() => {
						this.setHexText(targetQ, targetR, '');
					}),
				);
			}
			menu.addSeparator();
			const tiles = this.viewOptions?.getTerrainTiles() ?? [];
			if (tiles.length > 0) {
				menu.addItem((item) =>
					item.setTitle('Set terrain…').onClick(() => {
						this.openTerrainPicker(targetQ, targetR);
					}),
				);
			}
			const currentFeature = typeof existing?.f === 'string' ? normalizeTileId(existing.f) : '';
			const featureTiles = this.viewOptions?.getFeatureTiles() ?? [];
			if (featureTiles.length > 0) {
				menu.addItem((item) =>
					item.setTitle('Set feature…').onClick(() => {
						void (async (): Promise<void> => {
							try {
								await this.viewOptions?.refreshTiles?.();
							} catch {
								// Refresh is best effort; fall back to cached tiles.
							}
							const freshFeatures = [...(this.viewOptions?.getFeatureTiles() ?? featureTiles)];
							const parsedFeature = parseTileId(currentFeature);
							const modal = new TerrainModal(this.app, {
								title: 'Set feature',
								tiles: freshFeatures,
								currentId: currentFeature,
								initialSetId: parsedFeature?.setId,
								onPick: (featureId: string) => {
									this.setFeatureAt(targetQ, targetR, featureId);
								},
							});
							modal.open();
						})();
					}),
				);
			}
			if (currentFeature.length > 0) {
				menu.addItem((item) =>
					item.setTitle('Clear feature').onClick(() => {
						this.setFeatureAt(targetQ, targetR, '');
					}),
				);
			}
			if (tiles.length > 0 || featureTiles.length > 0 || currentFeature.length > 0) {
				menu.addSeparator();
			}
			const hasRoad = existing?.road === true;
			menu.addItem((item) =>
				item.setTitle(hasRoad ? 'Remove road' : 'Add road').onClick(() => {
					this.toggleRoadAt(targetQ, targetR);
				}),
			);
			const hasRiver = existing?.river === true;
			menu.addItem((item) =>
				item.setTitle(hasRiver ? 'Remove river' : 'Add river').onClick(() => {
					this.toggleRiverAt(targetQ, targetR);
				}),
			);
			if (this.hexes.size > 1) {
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle('Remove hex').onClick(() => {
						this.removeHexAt(targetQ, targetR);
					}),
				);
			}
		} else if (this.isValidGhost(axial.q, axial.r)) {
			const targetQ = axial.q;
			const targetR = axial.r;
			menu.addItem((item) =>
				item.setTitle('Create hex here').onClick(() => {
					this.createHexAt(targetQ, targetR);
				}),
			);
		} else {
			return;
		}
		menu.showAtMouseEvent(evt);
	}

	private isValidGhost(q: number, r: number): boolean {
		for (const offset of NEIGHBOR_OFFSETS) {
			if (this.hexes.has(hexKey(q + offset.dq, r + offset.dr))) {
				return true;
			}
		}
		return false;
	}

	private screenToWorld(clientX: number, clientY: number): WorldPoint | null {
		const canvas = this.canvas;
		if (canvas === null) {
			return null;
		}
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) {
			return null;
		}
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		return {
			x: this.cameraX + (sx - rect.width / 2) / this.zoom,
			y: this.cameraY + (sy - rect.height / 2) / this.zoom,
		};
	}

	private getDevicePixelRatio(): number {
		const view = this.wrapper?.ownerDocument.defaultView ?? window;
		const ratio = view.devicePixelRatio;
		if (typeof ratio === 'number' && ratio > 0) {
			return ratio;
		}
		return 1;
	}

	private getCssVariable(name: string, fallback: string): string {
		const el = this.wrapper;
		if (el === null) {
			return fallback;
		}
		const view = el.ownerDocument.defaultView;
		if (view === null) {
			return fallback;
		}
		const value = view.getComputedStyle(el).getPropertyValue(name).trim();
		return value.length > 0 ? value : fallback;
	}

	private resizeCanvas(): void {
		const wrapper = this.wrapper;
		const canvas = this.canvas;
		if (wrapper === null || canvas === null) {
			return;
		}
		const rect = wrapper.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) {
			return;
		}
		const dpr = this.getDevicePixelRatio();
		canvas.width = Math.floor(rect.width * dpr);
		canvas.height = Math.floor(rect.height * dpr);
	}

	private scheduleRedraw(): void {
		if (this.rafId !== null) {
			return;
		}
		this.rafId = window.requestAnimationFrame(() => {
			this.rafId = null;
			this.draw();
		});
	}

	private traceHexPath(cx: number, cy: number, scale = 1): void {
		const ctx = this.ctx;
		if (ctx === null) {
			return;
		}
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const angle = (Math.PI / 180) * (30 + 60 * i);
			const x = cx + HEX_SIZE * scale * Math.cos(angle);
			const y = cy + HEX_SIZE * scale * Math.sin(angle);
			if (i === 0) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		}
		ctx.closePath();
	}

	private draw(): void {
		const wrapper = this.wrapper;
		const canvas = this.canvas;
		const ctx = this.ctx;
		if (wrapper === null || canvas === null || ctx === null) {
			return;
		}
		const rect = wrapper.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) {
			return;
		}
		const dpr = this.getDevicePixelRatio();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, rect.width, rect.height);
		ctx.save();
		ctx.translate(rect.width / 2 - this.cameraX * this.zoom, rect.height / 2 - this.cameraY * this.zoom);
		ctx.scale(this.zoom, this.zoom);

		const viewHalfW = rect.width / 2 / this.zoom + HEX_SIZE * 2;
		const viewHalfH = rect.height / 2 / this.zoom + HEX_SIZE * 2;
		const minX = this.cameraX - viewHalfW;
		const maxX = this.cameraX + viewHalfW;
		const minY = this.cameraY - viewHalfH;
		const maxY = this.cameraY + viewHalfH;

		const fill = this.getCssVariable('--background-secondary', '#3a5f8a');
		const stroke = this.getCssVariable('--background-modifier-border', '#888888');
		const ghostStroke = this.getCssVariable('--text-faint', '#999999');
		const tiles = this.viewOptions?.getTerrainTiles() ?? [];
		const tuning = this.viewOptions?.getTuning() ?? DEFAULT_TUNING;
		const artSize = HEX_SIZE * 2.2 - tuning.artTrim;
		const bleedScale = 1.0;

		const ordered: Array<{ hex: AxialCoord; x: number; y: number; art: boolean }> = [];
		for (const hex of this.hexes.values()) {
			const pt = axialToPixel(hex.q, hex.r);
			if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) {
				continue;
			}
			ordered.push({ hex, x: pt.x, y: pt.y, art: false });
		}
		ordered.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
		const missingByHex = new Map<string, { terrain?: string; feature?: string }>();
		const markMissing = (qx: number, rx: number, slot: 'terrain' | 'feature', tileId: string): void => {
			const mapKey = hexKey(qx, rx);
			let record = missingByHex.get(mapKey);
			if (record === undefined) {
				record = {};
				missingByHex.set(mapKey, record);
			}
			record[slot] = tileId;
		};
		// LAYER_TERRAIN (10): base art paints first.
		for (const entry of ordered) {
			const requestedId =
				typeof entry.hex.t === 'string' && entry.hex.t.length > 0
					? normalizeTileId(entry.hex.t)
					: DEFAULT_TERRAIN_ID;
			const wanted = requestedId.length > 0 ? requestedId : DEFAULT_TERRAIN_ID;
			let tile = terrainTileById(tiles, wanted);
			if (tile === null && wanted !== DEFAULT_TERRAIN_ID) {
				markMissing(entry.hex.q, entry.hex.r, 'terrain', wanted);
				tile = terrainTileById(tiles, DEFAULT_TERRAIN_ID);
			}
			const img = tile === null ? null : getTerrainImage(tile.url, () => this.scheduleRedraw());
			if (img !== null) {
				ctx.save();
				this.traceHexPath(entry.x, entry.y, bleedScale);
				ctx.clip();
				ctx.drawImage(img, entry.x - artSize / 2, entry.y - artSize / 2, artSize, artSize);
				ctx.restore();
				entry.art = true;
			} else {
				this.traceHexPath(entry.x, entry.y);
				ctx.fillStyle = fill;
				ctx.fill();
			}
		}
		// LAYER_BORDER (11): thin edge above art softens tile transitions.
		if (tuning.borderWidth > 0) {
			ctx.save();
			ctx.strokeStyle = stroke;
			ctx.lineWidth = tuning.borderWidth;
			for (const entry of ordered) {
				if (!entry.art) {
					continue;
				}
				this.traceHexPath(entry.x, entry.y);
				ctx.stroke();
			}
			ctx.restore();
		}
		const featureTiles = this.viewOptions?.getFeatureTiles() ?? [];
		// LAYER_RIVER (13): ribbons paint above terrain, below roads for bridges.
		const riverChaos = tuning.riverBend;
		const blueT = Math.min(1, Math.max(0, tuning.riverBlue / 100));
		const riverRed = Math.round(0x66 + (0x2f - 0x66) * blueT);
		const riverGreen = Math.round(0x66 + (0x6f - 0x66) * blueT);
		const riverBlueMix = Math.round(0x66 + (0xb2 - 0x66) * blueT);
		const riverColor = this.getCssVariable(
			'--vpahexcrawl-river',
			`rgb(${riverRed}, ${riverGreen}, ${riverBlueMix})`,
		);
		const riverWidth = tuning.riverWidth;
		const riverWobble = 0.25;
		const hash01 = (a: number, b: number, c: number): number => {
			const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
			return s - Math.floor(s);
		};
		interface RiverPoint {
			x: number;
			y: number;
			d: number;
		}
		const riverWidthAt = (d: number, phase: number): number =>
			riverWidth * (1 + riverWobble * Math.sin(d * 0.12 + phase));
		const strokeWobbly = (points: RiverPoint[], phase: number): void => {
			for (let i = 0; i + 1 < points.length; i++) {
				const a = points[i];
				const b = points[i + 1];
				if (a === undefined || b === undefined) {
					continue;
				}
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.lineWidth = (riverWidthAt(a.d, phase) + riverWidthAt(b.d, phase)) / 2;
				ctx.stroke();
			}
		};
		ctx.save();
		ctx.strokeStyle = riverColor;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		for (const entry of ordered) {
			if (entry.hex.river !== true) {
				continue;
			}
			const corners = [0, 1, 2, 3, 4, 5].map((i) => hexCorner(entry.x, entry.y, i));
			const mouths: RiverPoint[] = [];
			for (const edge of GHOST_EDGES) {
				const nk = hexKey(entry.hex.q + edge.dq, entry.hex.r + edge.dr);
				const neighbor = this.hexes.get(nk);
				if (neighbor === undefined || neighbor.river !== true) {
					continue;
				}
				const p0 = corners[edge.c0];
				const p1 = corners[edge.c1];
				if (p0 === undefined || p1 === undefined) {
					continue;
				}
				const mx = (p0.x + p1.x) / 2;
				const my = (p0.y + p1.y) / 2;
				mouths.push({ x: mx, y: my, d: Math.hypot(mx - entry.x, my - entry.y) });
			}
			if (mouths.length === 0) {
				continue;
			}
			const center: RiverPoint = { x: entry.x, y: entry.y, d: 0 };
			const phase = hash01(entry.hex.q, entry.hex.r, 7) * Math.PI * 2;
			const at = (
				p0: RiverPoint,
				c1: RiverPoint,
				c2: RiverPoint,
				p1: RiverPoint,
				t: number,
			): RiverPoint => {
				const u = 1 - t;
				const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x;
				const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y;
				return { x, y, d: Math.hypot(x - entry.x, y - entry.y) };
			};
			const jittered = (from: RiverPoint, to: RiverPoint, salt: number): RiverPoint => {
				const j = (hash01(entry.hex.q, entry.hex.r, salt) - 0.5) * 2 * riverChaos;
				const dx = to.x - from.x;
				const dy = to.y - from.y;
				const len = Math.hypot(dx, dy) || 1;
				const x = (from.x + to.x) / 2 + (-dy / len) * j;
				const y = (from.y + to.y) / 2 + (dx / len) * j;
				return { x, y, d: Math.hypot(x - entry.x, y - entry.y) };
			};
			if (mouths.length === 2) {
				const m0 = mouths[0];
				const m1 = mouths[1];
				if (m0 === undefined || m1 === undefined) {
					continue;
				}
				const c1 = jittered(m0, center, 11);
				const c2 = jittered(center, m1, 23);
				const points: RiverPoint[] = [];
				for (let i = 0; i <= 10; i++) {
					points.push(at(m0, c1, c2, m1, i / 10));
				}
				strokeWobbly(points, phase);
			} else {
				mouths.forEach((m, index) => {
					const c = jittered(center, m, 31 + index);
					const points: RiverPoint[] = [];
					for (let i = 0; i <= 6; i++) {
						const t = i / 6;
						const u = 1 - t;
						const x = u * u * center.x + 2 * u * t * c.x + t * t * m.x;
						const y = u * u * center.y + 2 * u * t * c.y + t * t * m.y;
						points.push({ x, y, d: Math.hypot(x - entry.x, y - entry.y) });
					}
					strokeWobbly(points, phase);
				});
			}
		}
		ctx.restore();
		// LAYER_ROAD (16): links paint above terrain, below features.
		const roadCasing = this.getCssVariable('--vpahexcrawl-road-casing', '#2e2118');
		const roadFill = this.getCssVariable('--vpahexcrawl-road', '#c89b6a');
		const roadChaos = tuning.roadChaos;
		const traceRoadNetwork = (): void => {
			ctx.beginPath();
			for (const entry of ordered) {
				if (entry.hex.road !== true) {
					continue;
				}
				const corners = [0, 1, 2, 3, 4, 5].map((i) => hexCorner(entry.x, entry.y, i));
				let edgeIndex = 0;
				for (const edge of GHOST_EDGES) {
					const nk = hexKey(entry.hex.q + edge.dq, entry.hex.r + edge.dr);
					const neighbor = this.hexes.get(nk);
					if (neighbor === undefined || neighbor.road !== true) {
						edgeIndex += 1;
						continue;
					}
					const p0 = corners[edge.c0];
					const p1 = corners[edge.c1];
					if (p0 === undefined || p1 === undefined) {
						edgeIndex += 1;
						continue;
					}
					const mx = (p0.x + p1.x) / 2;
					const my = (p0.y + p1.y) / 2;
					const seed =
						Math.sin(entry.hex.q * 127.1 + entry.hex.r * 311.7 + edgeIndex * 74.7) *
						43758.5453;
					const jitter = (seed - Math.floor(seed) - 0.5) * 2 * roadChaos;
					const dx = mx - entry.x;
					const dy = my - entry.y;
					const len = Math.hypot(dx, dy) || 1;
					const cx = (entry.x + mx) / 2 + (-dy / len) * jitter;
					const cy = (entry.y + my) / 2 + (dx / len) * jitter;
					ctx.moveTo(entry.x, entry.y);
					ctx.quadraticCurveTo(cx, cy, mx, my);
					edgeIndex += 1;
				}
			}
		};
		ctx.save();
		ctx.lineCap = 'round';
		ctx.strokeStyle = roadCasing;
		const roadFillWidth = tuning.roadWidth / 10;
		ctx.lineWidth = roadFillWidth * 2.4;
		ctx.setLineDash([]);
		traceRoadNetwork();
		ctx.stroke();
		ctx.strokeStyle = roadFill;
		ctx.lineWidth = roadFillWidth;
		ctx.setLineDash([roadFillWidth * 3.2, roadFillWidth * 2.4]);
		traceRoadNetwork();
		ctx.stroke();
		ctx.restore();
		// LAYER_FEATURE (20): icons paint above terrain, below token and text.
		const featureSize = (HEX_SIZE * tuning.featureSize) / 50;
		const featureOffsetX = -HEX_SIZE * 0.2;
		const featureOffsetY = -5;
		for (const entry of ordered) {
			const rawFeatureId =
				typeof entry.hex.f === 'string' && entry.hex.f.length > 0 ? normalizeTileId(entry.hex.f) : '';
			if (rawFeatureId.length === 0) {
				continue;
			}
			const featureTile = terrainTileById(featureTiles, rawFeatureId);
			if (featureTile === null) {
				markMissing(entry.hex.q, entry.hex.r, 'feature', rawFeatureId);
				continue;
			}
			const featureImg = getTerrainImage(featureTile.url, () => this.scheduleRedraw());
			if (featureImg === null) {
				continue;
			}
			ctx.save();
			this.traceHexPath(entry.x, entry.y);
			ctx.clip();
			ctx.drawImage(
				featureImg,
				entry.x - featureSize / 2 + featureOffsetX,
				entry.y - featureSize / 2 + featureOffsetY,
				featureSize,
				featureSize,
			);
			ctx.restore();
		}
		for (const entry of ordered) {
			if (entry.art) {
				continue;
			}
			this.traceHexPath(entry.x, entry.y);
			ctx.lineWidth = 2;
			ctx.strokeStyle = stroke;
			ctx.stroke();
		}

		const ghosts = new Map<string, AxialCoord>();
		for (const hex of this.hexes.values()) {
			for (const offset of NEIGHBOR_OFFSETS) {
				const q = hex.q + offset.dq;
				const r = hex.r + offset.dr;
				const k = hexKey(q, r);
				if (!this.hexes.has(k) && !ghosts.has(k)) {
					ghosts.set(k, { q, r });
				}
			}
		}
		ctx.setLineDash([8, 6]);
		ctx.lineWidth = 2;
		ctx.strokeStyle = ghostStroke;
		ctx.beginPath();
		for (const ghost of ghosts.values()) {
			const pt = axialToPixel(ghost.q, ghost.r);
			if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) {
				continue;
			}
			const k = hexKey(ghost.q, ghost.r);
			const corners: WorldPoint[] = [0, 1, 2, 3, 4, 5].map((i) => hexCorner(pt.x, pt.y, i));
			for (const edge of GHOST_EDGES) {
				const nk = hexKey(ghost.q + edge.dq, ghost.r + edge.dr);
				if (this.hexes.has(nk)) {
					continue;
				}
				if (ghosts.has(nk) && nk < k) {
					continue;
				}
				const p0 = corners[edge.c0];
				const p1 = corners[edge.c1];
				if (p0 === undefined || p1 === undefined) {
					continue;
				}
				ctx.moveTo(p0.x, p0.y);
				ctx.lineTo(p1.x, p1.y);
			}
		}
		ctx.stroke();
		ctx.setLineDash([]);
		let tokenTarget: AxialCoord | null = null;
		if (this.tokenDragging && this.tokenDragPos !== null) {
			const hover = pixelToAxial(this.tokenDragPos.x, this.tokenDragPos.y);
			if (this.hexes.has(hexKey(hover.q, hover.r))) {
				tokenTarget = hover;
			}
		}
		// LAYER_TOKEN (30): token paints above art, below names.
		this.drawPlayerToken(tokenTarget);
		// LAYER_TEXT (40): names paint last, above everything.
		this.drawHexTexts(minX, maxX, minY, maxY);
		// LAYER_ERROR (50): missing tile labels paint over everything.
		this.drawTileErrors(ordered, missingByHex);
		ctx.restore();
	}

	private drawTileErrors(
		ordered: ReadonlyArray<{ hex: AxialCoord; x: number; y: number }>,
		missingByHex: ReadonlyMap<string, { terrain?: string; feature?: string }>,
	): void {
		const ctx = this.ctx;
		if (ctx === null || missingByHex.size === 0) {
			return;
		}
		const family = this.getInterfaceFont();
		ctx.save();
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		ctx.font = `9px ${family}`;
		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
		ctx.fillStyle = '#ff5555';
		const maxWidth = HEX_SIZE * 1.5;
		const lineHeight = 11;
		const wrapMessage = (message: string): string[] => {
			const words = message.split(' ').filter((word) => word.length > 0);
			const wrapped: string[] = [];
			let current = '';
			for (const word of words) {
				const candidate = current.length > 0 ? `${current} ${word}` : word;
				if (ctx.measureText(candidate).width <= maxWidth || current.length === 0) {
					current = candidate;
				} else {
					wrapped.push(current);
					current = word;
				}
			}
			if (current.length > 0) {
				wrapped.push(current);
			}
			return wrapped;
		};
		for (const entry of ordered) {
			const record = missingByHex.get(hexKey(entry.hex.q, entry.hex.r));
			if (record === undefined) {
				continue;
			}
			const messages: string[] = [];
			if (record.terrain !== undefined) {
				messages.push(`Missing tile png! ${record.terrain}`);
			}
			if (record.feature !== undefined) {
				messages.push(`Missing tile png! ${record.feature}`);
			}
			if (messages.length === 0) {
				continue;
			}
			const lines: string[] = [];
			for (const message of messages) {
				for (const wrapped of wrapMessage(message)) {
					lines.push(wrapped);
				}
			}
			const top = entry.y - ((lines.length - 1) * lineHeight) / 2;
			lines.forEach((line, index) => {
				const y = top + index * lineHeight;
				ctx.strokeText(line, entry.x, y);
				ctx.fillText(line, entry.x, y);
			});
		}
		ctx.restore();
	}

	private getInterfaceFont(): string {
		const themed = this.getCssVariable('--font-interface-theme', '');
		if (themed.length > 0) {
			return `${themed}, system-ui, sans-serif`;
		}
		return 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
	}

	private drawHexTexts(minX: number, maxX: number, minY: number, maxY: number): void {
		const ctx = this.ctx;
		if (ctx === null) {
			return;
		}
		const rung = (HEX_SIZE * 0.5 - 8) / 5;
		const tuning = this.viewOptions?.getTuning() ?? DEFAULT_TUNING;
		const textDrop = tuning.textDrop;
		const textSize = tuning.textSize;
		const bottomOffset = HEX_SIZE * 0.5 + rung + textDrop;
		const centerOffset = 8 + rung + textDrop;
		const color = this.getCssVariable('--text-normal', '#ffffff');
		const family = this.getInterfaceFont();
		ctx.save();
		ctx.textAlign = 'center';
		ctx.textBaseline = 'bottom';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.lineWidth = 2.5;
		ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
		ctx.shadowBlur = 4;
		ctx.shadowOffsetY = 2;
		for (const hex of this.hexes.values()) {
			if (typeof hex.txt !== 'string' || hex.txt.length === 0) {
				continue;
			}
			const pt = axialToPixel(hex.q, hex.r);
			if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) {
				continue;
			}
			const display = hex.txt;
			ctx.font = `${textSize}px ${family}`;
			ctx.fillStyle = color;
			if (display.length <= 10) {
				ctx.strokeText(display, pt.x, pt.y + bottomOffset);
				ctx.fillText(display, pt.x, pt.y + bottomOffset);
				continue;
			}
			const steps = Math.min(Math.max(display.length - 11, 0), 5);
			const blend = steps / 5;
			const y = pt.y + bottomOffset + (centerOffset - bottomOffset) * blend;
			ctx.strokeText(display, pt.x, y);
			ctx.fillText(display, pt.x, y);
		}
		ctx.restore();
	}
}
