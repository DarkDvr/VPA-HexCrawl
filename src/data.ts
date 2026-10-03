export interface StoredHex {
	t?: string;
	f?: string;
	txt?: string;
	road?: boolean;
	river?: boolean;
}

export interface HexcrawlSettings {
	riverBend: number;
	riverBlue: number;
	riverWidth: number;
	roadChaos: number;
	roadWidth: number;
	featureSize: number;
	artTrim: number;
	borderWidth: number;
	textSize: number;
	textDrop: number;
	tokenSize: number;
}

export interface HexcrawlData {
	version: 1;
	hexes: Record<string, StoredHex>;
	playerAt?: string | null;
	settings: HexcrawlSettings;
	tokenImage?: string;
}

export const DEFAULT_TUNING: HexcrawlSettings = {
	riverBend: 40,
	riverBlue: 100,
	riverWidth: 7,
	roadChaos: 14,
	roadWidth: 25,
	featureSize: 65,
	artTrim: 6,
	borderWidth: 1,
	textSize: 10,
	textDrop: 10,
	tokenSize: 50,
};

export const TUNING_LIMITS: Record<keyof HexcrawlSettings, { min: number; max: number }> = {
	riverBend: { min: 0, max: 60 },
	riverBlue: { min: 0, max: 100 },
	riverWidth: { min: 2, max: 14 },
	roadChaos: { min: 0, max: 30 },
	roadWidth: { min: 10, max: 60 },
	featureSize: { min: 25, max: 100 },
	artTrim: { min: 0, max: 12 },
	borderWidth: { min: 0, max: 4 },
	textSize: { min: 6, max: 13 },
	textDrop: { min: 0, max: 20 },
	tokenSize: { min: 25, max: 75 },
};

export function tunedValue(raw: Partial<HexcrawlSettings>, key: keyof HexcrawlSettings): number {
	const value = raw[key];
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return DEFAULT_TUNING[key];
	}
	const limits = TUNING_LIMITS[key];
	return Math.min(limits.max, Math.max(limits.min, value));
}

export function createDefaultSettings(): HexcrawlSettings {
	return { ...DEFAULT_TUNING };
}

export const HEXCRAWL_VERSION = 1 as const;

const HEX_KEY_PATTERN = /^-?\d+,-?\d+$/;

export function createDefaultData(): HexcrawlData {
	return {
		version: HEXCRAWL_VERSION,
		hexes: { '0,0': {} },
		playerAt: '0,0',
		settings: createDefaultSettings(),
	};
}

export function isHexcrawlData(value: unknown): value is HexcrawlData {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { version?: unknown; hexes?: unknown; playerAt?: unknown };
	if (candidate.version !== HEXCRAWL_VERSION) {
		return false;
	}
	if (typeof candidate.hexes !== 'object' || candidate.hexes === null) {
		return false;
	}
	for (const key of Object.keys(candidate.hexes)) {
		if (!HEX_KEY_PATTERN.test(key)) {
			return false;
		}
	}
	if (
		candidate.playerAt !== undefined &&
		candidate.playerAt !== null &&
		typeof candidate.playerAt !== 'string'
	) {
		return false;
	}
	if (typeof candidate.playerAt === 'string' && !HEX_KEY_PATTERN.test(candidate.playerAt)) {
		return false;
	}
	return true;
}

export const MAX_HEX_TEXT_LENGTH = 15;

export function sanitizeHexText(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_HEX_TEXT_LENGTH);
}

export function parseHexKey(key: string): { q: number; r: number } | null {
	if (!HEX_KEY_PATTERN.test(key)) {
		return null;
	}
	const parts = key.split(',');
	const qText = parts[0];
	const rText = parts[1];
	if (qText === undefined || rText === undefined) {
		return null;
	}
	const q = Number.parseInt(qText, 10);
	const r = Number.parseInt(rText, 10);
	if (Number.isNaN(q) || Number.isNaN(r)) {
		return null;
	}
	return { q, r };
}
