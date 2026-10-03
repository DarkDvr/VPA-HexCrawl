import { App, Notice, normalizePath } from 'obsidian';
import cliffUrl from '../assets/terrain/cliff.png';
import deepWoodsUrl from '../assets/terrain/deep_woods.png';
import defaultUrl from '../assets/terrain/default.png';
import desertUrl from '../assets/terrain/desert.png';
import desolateLandUrl from '../assets/terrain/desolate_land.png';
import farmlandUrl from '../assets/terrain/farmland.png';
import forestUrl from '../assets/terrain/forest.png';
import grasslandUrl from '../assets/terrain/grassland.png';
import hillsUrl from '../assets/terrain/hills.png';
import lakeUrl from '../assets/terrain/lake.png';
import mountainsUrl from '../assets/terrain/mountains.png';
import mysticalAreaUrl from '../assets/terrain/mystical_area.png';
import swampUrl from '../assets/terrain/swamp.png';
import volcanoUrl from '../assets/terrain/volcano.png';
import bonesAndSkullsUrl from '../assets/features/bones_and_skulls.png';
import caveEntranceUrl from '../assets/features/cave_entrance.png';
import chasmSinkholeUrl from '../assets/features/chasm_sinkhole.png';
import farmlandFieldsUrl from '../assets/features/farmland_fields.png';
import magicCrystalsUrl from '../assets/features/magic_crystals.png';
import guardTowerUrl from '../assets/features/guard_tower.png';
import largeTownUrl from '../assets/features/large_town.png';
import largeTwoStoryHouseUrl from '../assets/features/large_two_story_house.png';
import militaryOutpostUrl from '../assets/features/military_outpost.png';
import riverUrl from '../assets/features/river.png';
import ruinsUrl from '../assets/features/ruins.png';
import sailingShipUrl from '../assets/features/sailing_ship.png';
import smallHouseUrl from '../assets/features/small_house.png';
import smallVillageUrl from '../assets/features/small_village.png';

export interface TerrainTile {
	id: string;
	name: string;
	url: string;
	setId: string;
	setName: string;
	fileId: string;
}

export const DEFAULT_SET_ID = 'default';
export const DEFAULT_SET_NAME = 'Default';
export const DEFAULT_TERRAIN_FILE_ID = 'default';
export const DEFAULT_TERRAIN_ID = `${DEFAULT_SET_ID}:${DEFAULT_TERRAIN_FILE_ID}`;

export function tilesDir(app: App): string {
	return normalizePath(`${app.vault.configDir}/plugins/vpahexcrawl/tiles`);
}

export function terrainOverrideDir(app: App): string {
	return normalizePath(`${tilesDir(app)}/green/terrain`);
}

export function featureOverrideDir(app: App): string {
	return normalizePath(`${tilesDir(app)}/green/features`);
}

export const MIN_TILE_SIDE = 100;
export const MAX_TILE_SIDE = 300;
export const MIN_TILE_BYTES = 10 * 1024;
export const MAX_TILE_BYTES = 3 * 1024 * 1024;

export function tileDisplayName(id: string): string {
	const spaced = id.replace(/_/g, ' ').trim();
	if (spaced.length === 0) {
		return id;
	}
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function setDisplayName(setId: string): string {
	if (setId === DEFAULT_SET_ID) {
		return DEFAULT_SET_NAME;
	}
	return tileDisplayName(setId);
}

export function namespacedTileId(setId: string, fileId: string): string {
	return `${setId.toLowerCase()}:${fileId.toLowerCase()}`;
}

export function parseTileId(raw: string): { setId: string; fileId: string } | null {
	if (raw.length === 0) {
		return null;
	}
	const colon = raw.indexOf(':');
	if (colon < 0) {
		const file = raw.toLowerCase();
		if (file.length === 0) {
			return null;
		}
		return { setId: DEFAULT_SET_ID, fileId: file };
	}
	const set = raw.slice(0, colon).toLowerCase();
	const file = raw.slice(colon + 1).toLowerCase();
	if (set.length === 0 || file.length === 0) {
		return null;
	}
	return { setId: set, fileId: file };
}

export function normalizeTileId(raw: string): string {
	if (raw.length === 0) {
		return '';
	}
	const parsed = parseTileId(raw);
	if (parsed === null) {
		return '';
	}
	return namespacedTileId(parsed.setId, parsed.fileId);
}

function withSet(
	fileId: string,
	url: string,
	setId: string,
): TerrainTile {
	const namespaced = namespacedTileId(setId, fileId);
	return {
		id: namespaced,
		name: tileDisplayName(fileId),
		url,
		setId: setId.toLowerCase(),
		setName: setDisplayName(setId.toLowerCase()),
		fileId: fileId.toLowerCase(),
	};
}

export const EMBEDDED_TERRAIN: TerrainTile[] = [
	{ id: 'cliff', url: cliffUrl },
	{ id: 'deep_woods', url: deepWoodsUrl },
	{ id: 'default', url: defaultUrl },
	{ id: 'desert', url: desertUrl },
	{ id: 'desolate_land', url: desolateLandUrl },
	{ id: 'farmland', url: farmlandUrl },
	{ id: 'forest', url: forestUrl },
	{ id: 'grassland', url: grasslandUrl },
	{ id: 'hills', url: hillsUrl },
	{ id: 'lake', url: lakeUrl },
	{ id: 'mountains', url: mountainsUrl },
	{ id: 'mystical_area', url: mysticalAreaUrl },
	{ id: 'swamp', url: swampUrl },
	{ id: 'volcano', url: volcanoUrl },
].map((tile) => withSet(tile.id, tile.url, DEFAULT_SET_ID));

export const EMBEDDED_FEATURES: TerrainTile[] = [
	{ id: 'bones_and_skulls', url: bonesAndSkullsUrl },
	{ id: 'cave_entrance', url: caveEntranceUrl },
	{ id: 'chasm_sinkhole', url: chasmSinkholeUrl },
	{ id: 'farmland_fields', url: farmlandFieldsUrl },
	{ id: 'magic_crystals', url: magicCrystalsUrl },
	{ id: 'guard_tower', url: guardTowerUrl },
	{ id: 'large_town', url: largeTownUrl },
	{ id: 'large_two_story_house', url: largeTwoStoryHouseUrl },
	{ id: 'military_outpost', url: militaryOutpostUrl },
	{ id: 'river', url: riverUrl },
	{ id: 'ruins', url: ruinsUrl },
	{ id: 'sailing_ship', url: sailingShipUrl },
	{ id: 'small_house', url: smallHouseUrl },
	{ id: 'small_village', url: smallVillageUrl },
].map((tile) => withSet(tile.id, tile.url, DEFAULT_SET_ID));

async function ensureDir(app: App, dir: string): Promise<void> {
	const segments = dir.split('/');
	let prefix = '';
	for (const segment of segments) {
		prefix = prefix.length > 0 ? `${prefix}/${segment}` : segment;
		if (!(await app.vault.adapter.exists(prefix))) {
			await app.vault.createFolder(prefix);
		}
	}
}

export async function ensureTilesDir(app: App): Promise<void> {
	await ensureDir(app, tilesDir(app));
}

export async function ensureTerrainOverrideDir(app: App): Promise<void> {
	await ensureDir(app, terrainOverrideDir(app));
}

export async function ensureFeatureOverrideDir(app: App): Promise<void> {
	await ensureDir(app, featureOverrideDir(app));
}

function baseName(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash >= 0 ? path.slice(slash + 1) : path;
}

async function listTilesetDirs(app: App): Promise<Array<{ setId: string; dir: string }>> {
	let listed;
	try {
		listed = await app.vault.adapter.list(tilesDir(app));
	} catch {
		return [];
	}
	const out: Array<{ setId: string; dir: string }> = [];
	for (const folderPath of listed.folders) {
		const rawName = baseName(folderPath);
		if (rawName.length === 0) {
			continue;
		}
		const setId = rawName.toLowerCase();
		if (setId === DEFAULT_SET_ID || setId === 'green') {
			continue;
		}
		out.push({ setId, dir: folderPath });
	}
	return out;
}

async function listPngTiles(
	app: App,
	dir: string,
	setId: string,
	kind: string,
): Promise<TerrainTile[]> {
	let listed;
	try {
		listed = await app.vault.adapter.list(dir);
	} catch {
		return [];
	}
	const out: TerrainTile[] = [];
	for (const filePath of listed.files) {
		if (!filePath.toLowerCase().endsWith('.png')) {
			continue;
		}
		const fileName = baseName(filePath);
		const dot = fileName.lastIndexOf('.');
		const fileId = (dot >= 0 ? fileName.slice(0, dot) : fileName).toLowerCase();
		if (fileId.length === 0) {
			continue;
		}
		let sizeOk = true;
		try {
			const stat = await app.vault.adapter.stat(filePath);
			if (stat !== null) {
				if (stat.size < MIN_TILE_BYTES || stat.size > MAX_TILE_BYTES) {
					new Notice(
						`${kind} tile skipped, file size outside 10 KB to 3 MB: ${setId}:${fileId}.`,
					);
					console.warn(
						`VPA HexCrawl: ${kind.toLowerCase()} tile outside 10 KB to 3 MB: ${setId}:${fileId} (${stat.size} bytes)`,
					);
					sizeOk = false;
				}
			}
		} catch {
			sizeOk = true;
		}
		if (!sizeOk) {
			continue;
		}
		out.push({
			id: namespacedTileId(setId, fileId),
			name: tileDisplayName(fileId),
			url: app.vault.adapter.getResourcePath(filePath),
			setId: setId.toLowerCase(),
			setName: setDisplayName(setId.toLowerCase()),
			fileId,
		});
	}
	return out;
}

export async function listTerrainOverrideTiles(app: App): Promise<TerrainTile[]> {
	return listPngTiles(app, terrainOverrideDir(app), DEFAULT_SET_ID, 'Terrain');
}

export async function listFeatureOverrideTiles(app: App): Promise<TerrainTile[]> {
	return listPngTiles(app, featureOverrideDir(app), DEFAULT_SET_ID, 'Feature');
}

async function listCustomTiles(
	app: App,
	subfolder: 'terrain' | 'features',
	kind: string,
): Promise<TerrainTile[]> {
	const sets = await listTilesetDirs(app);
	const out: TerrainTile[] = [];
	for (const set of sets) {
		const dir = normalizePath(`${set.dir}/${subfolder}`);
		const tiles = await listPngTiles(app, dir, set.setId, kind);
		for (const tile of tiles) {
			out.push(tile);
		}
	}
	return out;
}

export function measureTerrainImage(url: string): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = (): void => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = (): void => {
			resolve(null);
		};
		img.src = url;
	});
}

export async function loadTerrainTiles(app: App): Promise<TerrainTile[]> {
	await ensureTilesDir(app);
	await ensureTerrainOverrideDir(app);
	const customs = await listCustomTiles(app, 'terrain', 'Terrain');
	const fileTiles = [...(await listTerrainOverrideTiles(app)), ...customs];
	return loadTiles(EMBEDDED_TERRAIN, fileTiles, 'Terrain');
}

export async function loadFeatureTiles(app: App): Promise<TerrainTile[]> {
	await ensureTilesDir(app);
	await ensureFeatureOverrideDir(app);
	const customs = await listCustomTiles(app, 'features', 'Feature');
	const fileTiles = [...(await listFeatureOverrideTiles(app)), ...customs];
	return loadTiles(EMBEDDED_FEATURES, fileTiles, 'Feature');
}

async function loadTiles(
	embedded: ReadonlyArray<TerrainTile>,
	fileTiles: ReadonlyArray<TerrainTile>,
	kind: string,
): Promise<TerrainTile[]> {
	const merged = new Map<string, TerrainTile>();
	for (const tile of embedded) {
		merged.set(tile.id, tile);
	}
	for (const tile of fileTiles) {
		const measured = await measureTerrainImage(tile.url);
		if (measured === null) {
			new Notice(`${kind} tile skipped, file failed to load: ${tile.id}.`);
			console.warn(`VPA HexCrawl: ${kind.toLowerCase()} tile failed to load: ${tile.id}`);
			continue;
		}
		if (
			measured.width < MIN_TILE_SIDE ||
			measured.width > MAX_TILE_SIDE ||
			measured.height < MIN_TILE_SIDE ||
			measured.height > MAX_TILE_SIDE
		) {
			new Notice(`${kind} tile skipped, size outside 100 to 300 pixels: ${tile.id}.`);
			console.warn(
				`VPA HexCrawl: ${kind.toLowerCase()} tile outside 100 to 300 pixels: ${tile.id} (${measured.width}x${measured.height})`,
			);
			continue;
		}
		merged.set(tile.id, tile);
	}
	return [...merged.values()].sort((a, b) => {
		if (a.setId !== b.setId) {
			if (a.setId === DEFAULT_SET_ID) {
				return -1;
			}
			if (b.setId === DEFAULT_SET_ID) {
				return 1;
			}
			return a.setName.localeCompare(b.setName);
		}
		return a.name.localeCompare(b.name);
	});
}

interface CachedTileImage {
	img: HTMLImageElement;
	ready: boolean;
	waiters: Array<() => void>;
}

const tileImageCache = new Map<string, CachedTileImage>();

export function getTerrainImage(url: string, onReady: () => void): HTMLImageElement | null {
	const existing = tileImageCache.get(url);
	if (existing !== undefined) {
		if (existing.ready && existing.img.naturalWidth > 0) {
			return existing.img;
		}
		existing.waiters.push(onReady);
		return null;
	}
	const img = new Image();
	const fresh: CachedTileImage = { img, ready: false, waiters: [] };
	tileImageCache.set(url, fresh);
	img.onload = (): void => {
		fresh.ready = true;
		for (const waiter of fresh.waiters) {
			waiter();
		}
		fresh.waiters = [];
	};
	fresh.waiters.push(onReady);
	img.src = url;
	return null;
}

export function terrainTileById(tiles: ReadonlyArray<TerrainTile>, id: string): TerrainTile | null {
	const normalized = normalizeTileId(id);
	if (normalized.length === 0) {
		return null;
	}
	for (const tile of tiles) {
		if (tile.id === normalized) {
			return tile;
		}
	}
	return null;
}

export function tilesetOptions(tiles: ReadonlyArray<TerrainTile>): Array<{ setId: string; setName: string }> {
	const seen = new Map<string, string>();
	for (const tile of tiles) {
		if (!seen.has(tile.setId)) {
			seen.set(tile.setId, tile.setName);
		}
	}
	const out = [...seen.entries()].map(([setId, setName]) => ({ setId, setName }));
	out.sort((a, b) => {
		if (a.setId === DEFAULT_SET_ID) {
			return -1;
		}
		if (b.setId === DEFAULT_SET_ID) {
			return 1;
		}
		return a.setName.localeCompare(b.setName);
	});
	return out;
}
