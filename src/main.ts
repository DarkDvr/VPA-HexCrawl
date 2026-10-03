import { Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { createDefaultData, isHexcrawlData, parseHexKey, sanitizeHexText, tunedValue, TUNING_LIMITS, type HexcrawlData, type HexcrawlSettings } from './data';
import { HEXMAP_VIEW_TYPE, HexmapView, type AxialCoord } from './hexmap-view';
import { VpaHexcrawlSettingTab } from './settings-tab';
import {
	DEFAULT_TERRAIN_ID,
	loadFeatureTiles,
	loadTerrainTiles,
	measureTerrainImage,
	normalizeTileId,
	terrainTileById,
	type TerrainTile,
} from './tiles';

const TOKEN_MIN_SIDE = 64;
const TOKEN_MAX_SIDE = 1024;
const TOKEN_MAX_BYTES = 5 * 1024 * 1024;
const TOKEN_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

function migrateRoadWidth(raw: Partial<HexcrawlSettings>): number {
	const legacy = raw.roadWidth;
	if (typeof legacy === 'number' && legacy < 10) {
		return Math.min(TUNING_LIMITS.roadWidth.max, Math.max(TUNING_LIMITS.roadWidth.min, legacy * 10));
	}
	return tunedValue(raw, 'roadWidth');
}

export default class VpaHexcrawlPlugin extends Plugin {
	private persisted: HexcrawlData = createDefaultData();
	private saveTimer: number | null = null;
	private terrainTiles: TerrainTile[] = [];
	private featureTiles: TerrainTile[] = [];

	async onload(): Promise<void> {
		const loaded = (await this.loadData()) as unknown;
		this.persisted = isHexcrawlData(loaded) ? loaded : createDefaultData();
		const rawSettings: Partial<HexcrawlSettings> = this.persisted.settings ?? {};
		this.persisted.settings = {
			riverBend: tunedValue(rawSettings, 'riverBend'),
			riverBlue: tunedValue(rawSettings, 'riverBlue'),
			riverWidth: tunedValue(rawSettings, 'riverWidth'),
			roadChaos: tunedValue(rawSettings, 'roadChaos'),
			roadWidth: migrateRoadWidth(rawSettings),
			featureSize: tunedValue(rawSettings, 'featureSize'),
			artTrim: tunedValue(rawSettings, 'artTrim'),
			borderWidth: tunedValue(rawSettings, 'borderWidth'),
			textSize: tunedValue(rawSettings, 'textSize'),
			textDrop: tunedValue(rawSettings, 'textDrop'),
			tokenSize: tunedValue(rawSettings, 'tokenSize'),
		};
		if (Object.keys(this.persisted.hexes).length === 0) {
			this.persisted.hexes['0,0'] = {};
		}
		if (
			typeof this.persisted.playerAt !== 'string' ||
			this.persisted.hexes[this.persisted.playerAt] === undefined
		) {
			this.persisted.playerAt = this.findPlayerFallback();
		}
		if (this.backfillDefaultTerrain()) {
			this.scheduleSave();
		}
		if (typeof this.persisted.tokenImage !== 'string' || this.persisted.tokenImage.trim().length === 0) {
			if (this.persisted.tokenImage !== undefined) {
				delete this.persisted.tokenImage;
				this.scheduleSave();
			}
		}
		this.terrainTiles = await loadTerrainTiles(this.app);
		this.featureTiles = await loadFeatureTiles(this.app);
		this.registerView(HEXMAP_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			return new HexmapView(leaf, {
				initialHexes: this.getHexList(),
				initialPlayerAt: this.getPlayerAt(),
				onHexesAdded: (coords: ReadonlyArray<AxialCoord>) => {
					this.handleHexesAdded(coords);
				},
				onHexesRemoved: (coords: ReadonlyArray<AxialCoord>) => {
					this.handleHexesRemoved(coords);
				},
				onHexTextSet: (coord: AxialCoord, text: string) => {
					this.handleHexTextSet(coord, text);
				},
				onPlayerSet: (coord: AxialCoord) => {
					this.handlePlayerSet(coord);
				},
				getTerrainTiles: () => this.terrainTiles,
				onTerrainSet: (coord: AxialCoord, terrainId: string) => {
					this.handleTerrainSet(coord, terrainId);
				},
				getFeatureTiles: () => this.featureTiles,
				onFeatureSet: (coord: AxialCoord, featureId: string) => {
					this.handleFeatureSet(coord, featureId);
				},
				refreshTiles: async (): Promise<void> => {
					await this.reloadTerrainTiles();
				},
				getTokenImageUrl: () => this.getTokenImageUrl(),
				onRoadSet: (coord: AxialCoord, hasRoad: boolean) => {
					this.handleRoadSet(coord, hasRoad);
				},
				onRiverSet: (coord: AxialCoord, hasRiver: boolean) => {
					this.handleRiverSet(coord, hasRiver);
				},
				getTuning: () => this.getTuning(),
			});
		});
		this.addRibbonIcon('hexagon', 'Open hex map', () => {
			void this.activateView();
		});
		this.addSettingTab(new VpaHexcrawlSettingTab(this.app, this));
		this.addCommand({
			id: 'open-map',
			name: 'Open hex map',
			callback: () => {
				void this.activateView();
			},
		});
		this.addCommand({
			id: 'fill-test-hexes',
			name: 'Fill test hexes',
			callback: () => {
				void this.fillTestHexes();
			},
		});
		this.addCommand({
			id: 'reload-tiles',
			name: 'Reload terrain tiles',
			callback: () => {
				void this.reloadTerrainTiles();
			},
		});
	}

	onunload(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		// Obsidian handles leaf cleanup automatically.
	}

	private backfillDefaultTerrain(): boolean {
		let changed = false;
		for (const key of Object.keys(this.persisted.hexes)) {
			const stored = this.persisted.hexes[key];
			if (stored === undefined) {
				continue;
			}
			if (stored.t === undefined) {
				stored.t = DEFAULT_TERRAIN_ID;
				changed = true;
			} else {
				const normalizedTerrain = normalizeTileId(stored.t);
				const nextTerrain = normalizedTerrain.length > 0 ? normalizedTerrain : DEFAULT_TERRAIN_ID;
				if (stored.t !== nextTerrain) {
					stored.t = nextTerrain;
					changed = true;
				}
			}
			if (typeof stored.f === 'string' && stored.f.length > 0) {
				const normalizedFeature = normalizeTileId(stored.f);
				if (normalizedFeature.length === 0) {
					delete stored.f;
					changed = true;
				} else if (stored.f !== normalizedFeature) {
					stored.f = normalizedFeature;
					changed = true;
				}
			}
		}
		return changed;
	}

	private getHexList(): AxialCoord[] {
		const out: AxialCoord[] = [];
		for (const key of Object.keys(this.persisted.hexes)) {
			const parsed = parseHexKey(key);
			if (parsed !== null) {
				const stored = this.persisted.hexes[key];
				const entry: AxialCoord = { q: parsed.q, r: parsed.r };
				const rawText = typeof stored?.txt === 'string' ? stored.txt : '';
				const cleaned = sanitizeHexText(rawText);
				if (cleaned.length > 0) {
					entry.txt = cleaned;
				}
				if (typeof stored?.t === 'string' && stored.t.length > 0) {
					const normalizedStored = normalizeTileId(stored.t);
					entry.t = normalizedStored.length > 0 ? normalizedStored : DEFAULT_TERRAIN_ID;
				} else {
					entry.t = DEFAULT_TERRAIN_ID;
				}
				if (typeof stored?.f === 'string' && stored.f.length > 0) {
					const normalizedFeature = normalizeTileId(stored.f);
					if (normalizedFeature.length > 0) {
						entry.f = normalizedFeature;
					}
				}
				if (stored?.road === true) {
					entry.road = true;
				}
				if (stored?.river === true) {
					entry.river = true;
				}
				out.push(entry);
			}
		}
		return out;
	}

	private handleHexesAdded(coords: ReadonlyArray<AxialCoord>): void {
		let changed = false;
		for (const coord of coords) {
			const key = `${coord.q},${coord.r}`;
			if (this.persisted.hexes[key] === undefined) {
				const rawTerrain =
					typeof coord.t === 'string' && coord.t.length > 0 ? normalizeTileId(coord.t) : DEFAULT_TERRAIN_ID;
				const terrain = rawTerrain.length > 0 ? rawTerrain : DEFAULT_TERRAIN_ID;
				if (typeof coord.txt === 'string' && sanitizeHexText(coord.txt).length > 0) {
					this.persisted.hexes[key] = { t: terrain, txt: sanitizeHexText(coord.txt) };
				} else {
					this.persisted.hexes[key] = { t: terrain };
				}
				changed = true;
			}
		}
		if (changed) {
			this.scheduleSave();
		}
	}

	private handleTerrainSet(coord: AxialCoord, terrainId: string): void {
		const key = `${coord.q},${coord.r}`;
		const existing = this.persisted.hexes[key];
		if (existing === undefined) {
			return;
		}
		const normalized = normalizeTileId(terrainId);
		if (normalized.length === 0) {
			return;
		}
		if (terrainTileById(this.terrainTiles, normalized) === null) {
			return;
		}
		if (existing.t !== normalized) {
			existing.t = normalized;
			this.scheduleSave();
		}
	}

	private handleFeatureSet(coord: AxialCoord, featureId: string): void {
		const key = `${coord.q},${coord.r}`;
		const existing = this.persisted.hexes[key];
		if (existing === undefined) {
			return;
		}
		if (featureId.length === 0) {
			if (existing.f !== undefined) {
				delete existing.f;
				this.scheduleSave();
			}
			return;
		}
		const normalizedFeature = normalizeTileId(featureId);
		if (normalizedFeature.length === 0) {
			return;
		}
		if (terrainTileById(this.featureTiles, normalizedFeature) === null) {
			return;
		}
		if (existing.f !== normalizedFeature) {
			existing.f = normalizedFeature;
			this.scheduleSave();
		}
	}

	private handleRoadSet(coord: AxialCoord, hasRoad: boolean): void {
		const key = `${coord.q},${coord.r}`;
		const existing = this.persisted.hexes[key];
		if (existing === undefined) {
			return;
		}
		if (hasRoad) {
			if (existing.road !== true) {
				existing.road = true;
				this.scheduleSave();
			}
		} else if (existing.road !== undefined) {
			delete existing.road;
			this.scheduleSave();
		}
	}

	private handleRiverSet(coord: AxialCoord, hasRiver: boolean): void {
		const key = `${coord.q},${coord.r}`;
		const existing = this.persisted.hexes[key];
		if (existing === undefined) {
			return;
		}
		if (hasRiver) {
			if (existing.river !== true) {
				existing.river = true;
				this.scheduleSave();
			}
		} else if (existing.river !== undefined) {
			delete existing.river;
			this.scheduleSave();
		}
	}

	private async reloadTerrainTiles(): Promise<void> {
		this.terrainTiles = await loadTerrainTiles(this.app);
		this.featureTiles = await loadFeatureTiles(this.app);
		const leaves = this.app.workspace.getLeavesOfType(HEXMAP_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof HexmapView) {
				leaf.view.redraw();
			}
		}
	}

	getTokenImagePath(): string {
		return typeof this.persisted.tokenImage === 'string' ? this.persisted.tokenImage : '';
	}

	getTokenImageUrl(): string | null {
		const path = this.getTokenImagePath();
		if (path.length === 0) {
			return null;
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}
		if (!TOKEN_IMAGE_EXTENSIONS.includes(file.extension.toLowerCase())) {
			return null;
		}
		if (file.stat.size > TOKEN_MAX_BYTES) {
			return null;
		}
		return this.app.vault.getResourcePath(file);
	}

	setTokenImage(path: string): void {
		const cleaned = path.trim();
		if (cleaned.length === 0) {
			if (this.persisted.tokenImage === undefined) {
				return;
			}
			delete this.persisted.tokenImage;
			this.scheduleSave();
			this.redrawViews();
			return;
		}
		if (this.getTokenImagePath() === cleaned) {
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(cleaned);
		if (!(file instanceof TFile)) {
			new Notice('Token image skipped, file not found in your vault.');
			return;
		}
		if (!TOKEN_IMAGE_EXTENSIONS.includes(file.extension.toLowerCase())) {
			new Notice('Token image skipped, file is not a supported image.');
			return;
		}
		if (file.stat.size > TOKEN_MAX_BYTES) {
			new Notice('Token image skipped, file is larger than 5 megabytes.');
			return;
		}
		this.persisted.tokenImage = cleaned;
		this.scheduleSave();
		this.redrawViews();
		void this.validateTokenDimensions(cleaned);
	}

	private async validateTokenDimensions(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return;
		}
		if (this.getTokenImagePath() !== path) {
			return;
		}
		const measured = await measureTerrainImage(this.app.vault.getResourcePath(file));
		if (this.getTokenImagePath() !== path) {
			return;
		}
		if (measured === null) {
			new Notice('Token image skipped, file failed to load.');
			delete this.persisted.tokenImage;
			this.scheduleSave();
			this.redrawViews();
			return;
		}
		if (
			measured.width < TOKEN_MIN_SIDE ||
			measured.width > TOKEN_MAX_SIDE ||
			measured.height < TOKEN_MIN_SIDE ||
			measured.height > TOKEN_MAX_SIDE
		) {
			new Notice('Token image skipped, size outside 64 to 1024 pixels.');
			delete this.persisted.tokenImage;
			this.scheduleSave();
			this.redrawViews();
			return;
		}
		this.redrawViews();
	}

	private handleHexTextSet(coord: AxialCoord, text: string): void {
		const key = `${coord.q},${coord.r}`;
		const existing = this.persisted.hexes[key];
		if (existing === undefined) {
			return;
		}
		const cleaned = sanitizeHexText(text);
		if (cleaned.length > 0) {
			if (existing.txt !== cleaned) {
				existing.txt = cleaned;
				this.scheduleSave();
			}
		} else if (existing.txt !== undefined) {
			delete existing.txt;
			this.scheduleSave();
		}
	}

	private handleHexesRemoved(coords: ReadonlyArray<AxialCoord>): void {
		if (Object.keys(this.persisted.hexes).length <= 1) {
			return;
		}
		let changed = false;
		for (const coord of coords) {
			const key = `${coord.q},${coord.r}`;
			if (this.persisted.hexes[key] !== undefined) {
				if (Object.keys(this.persisted.hexes).length <= 1) {
					break;
				}
				delete this.persisted.hexes[key];
				changed = true;
			}
		}
		if (changed) {
			if (Object.keys(this.persisted.hexes).length === 0) {
				this.persisted.hexes['0,0'] = {};
			}
			if (
				typeof this.persisted.playerAt !== 'string' ||
				this.persisted.hexes[this.persisted.playerAt] === undefined
			) {
				this.persisted.playerAt = this.findPlayerFallback();
			}
			this.scheduleSave();
		}
	}

	private handlePlayerSet(coord: AxialCoord): void {
		const key = `${coord.q},${coord.r}`;
		if (this.persisted.hexes[key] === undefined) {
			return;
		}
		if (this.persisted.playerAt !== key) {
			this.persisted.playerAt = key;
			this.scheduleSave();
		}
	}

	private findPlayerFallback(): string {
		if (this.persisted.hexes['0,0'] !== undefined) {
			return '0,0';
		}
		const keys = Object.keys(this.persisted.hexes).sort();
		const first = keys[0];
		if (first !== undefined) {
			return first;
		}
		return '0,0';
	}

	private getPlayerAt(): AxialCoord | null {
		const raw = this.persisted.playerAt;
		if (typeof raw === 'string') {
			const parsed = parseHexKey(raw);
			if (parsed !== null && this.persisted.hexes[raw] !== undefined) {
				return parsed;
			}
		}
		const fallback = this.findPlayerFallback();
		const parsedFallback = parseHexKey(fallback);
		if (parsedFallback !== null && this.persisted.hexes[fallback] !== undefined) {
			return parsedFallback;
		}
		return null;
	}

	getTuning(): HexcrawlSettings {
		const raw: Partial<HexcrawlSettings> = this.persisted.settings ?? {};
		return {
			riverBend: tunedValue(raw, 'riverBend'),
			riverBlue: tunedValue(raw, 'riverBlue'),
			riverWidth: tunedValue(raw, 'riverWidth'),
			roadChaos: tunedValue(raw, 'roadChaos'),
			roadWidth: tunedValue(raw, 'roadWidth'),
			featureSize: tunedValue(raw, 'featureSize'),
			artTrim: tunedValue(raw, 'artTrim'),
			borderWidth: tunedValue(raw, 'borderWidth'),
			textSize: tunedValue(raw, 'textSize'),
			textDrop: tunedValue(raw, 'textDrop'),
			tokenSize: tunedValue(raw, 'tokenSize'),
		};
	}

	setTuningValue(key: string, value: number): void {
		if (!(key in TUNING_LIMITS)) {
			return;
		}
		const knownKey = key as keyof HexcrawlSettings;
		const limits = TUNING_LIMITS[knownKey];
		this.persisted.settings[knownKey] = Math.min(limits.max, Math.max(limits.min, Math.round(value)));
		this.scheduleSave();
		this.redrawViews();
	}

	redrawViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(HEXMAP_VIEW_TYPE)) {
			if (leaf.view instanceof HexmapView) {
				leaf.view.redraw();
			}
		}
	}

	resetMapKeepSettings(): void {
		this.persisted.hexes = { '0,0': { t: DEFAULT_TERRAIN_ID } };
		this.persisted.playerAt = '0,0';
		this.scheduleSave();
		for (const leaf of this.app.workspace.getLeavesOfType(HEXMAP_VIEW_TYPE)) {
			if (leaf.view instanceof HexmapView) {
				leaf.view.resetMapToDefault();
			}
		}
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveData(this.persisted);
		}, 1000);
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(HEXMAP_VIEW_TYPE);
		const first = existing[0];
		if (first !== undefined) {
			void this.app.workspace.revealLeaf(first);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: HEXMAP_VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}

	private async fillTestHexes(): Promise<void> {
		await this.activateView();
		const leaves = this.app.workspace.getLeavesOfType(HEXMAP_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof HexmapView) {
				leaf.view.fillTestArea(13);
			}
		}
	}
}
