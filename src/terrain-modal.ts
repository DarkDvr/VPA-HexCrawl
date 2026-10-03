import { Modal, type App } from 'obsidian';
import { DEFAULT_SET_ID, parseTileId, tilesetOptions, type TerrainTile } from './tiles';

export interface TerrainModalOptions {
	title: string;
	tiles: ReadonlyArray<TerrainTile>;
	currentId: string;
	onPick: (terrainId: string) => void;
	initialSetId?: string;
}

export class TerrainModal extends Modal {
	private title: string;
	private tiles: ReadonlyArray<TerrainTile>;
	private currentId: string;
	private onPick: (terrainId: string) => void;
	private initialSetId?: string;

	constructor(app: App, options: TerrainModalOptions) {
		super(app);
		this.title = options.title;
		this.tiles = options.tiles;
		this.currentId = options.currentId;
		this.onPick = options.onPick;
		this.initialSetId = options.initialSetId;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vpahexcrawl-terrain-modal');
		contentEl.createEl('h2', { text: this.title, cls: 'vpahexcrawl-terrain-title' });
		const sets = tilesetOptions(this.tiles);
		let selected = '';
		if (this.initialSetId !== undefined && sets.some((set) => set.setId === this.initialSetId)) {
			selected = this.initialSetId ?? '';
		}
		if (selected.length === 0) {
			const parsed = parseTileId(this.currentId);
			if (parsed !== null && sets.some((set) => set.setId === parsed.setId)) {
				selected = parsed.setId;
			}
		}
		if (selected.length === 0 && sets.some((set) => set.setId === DEFAULT_SET_ID)) {
			selected = DEFAULT_SET_ID;
		}
		if (selected.length === 0 && sets.length > 0) {
			const first = sets[0];
			if (first !== undefined) {
				selected = first.setId;
			}
		}
		if (sets.length > 1) {
			const row = contentEl.createDiv({ cls: 'vpahexcrawl-tileset-row' });
			row.createEl('label', { text: 'Tileset', cls: 'vpahexcrawl-tileset-label' });
			const select = row.createEl('select', { cls: 'vpahexcrawl-tileset-select' });
			for (const set of sets) {
				const option = select.createEl('option', { text: set.setName });
				option.value = set.setId;
				if (set.setId === selected) {
					option.selected = true;
				}
			}
			select.addEventListener('change', () => {
				selected = select.value;
				renderList();
			});
		}
		const list = contentEl.createDiv({ cls: 'vpahexcrawl-terrain-list' });
		const renderList = (): void => {
			list.empty();
			for (const tile of this.tiles) {
				if (tile.setId !== selected) {
					continue;
				}
				const tileId = tile.id;
				const isCurrent = tileId === this.currentId;
				const button = list.createEl('button', {
					cls: 'vpahexcrawl-terrain-pick' + (isCurrent ? ' is-active' : ''),
					attr: { 'aria-label': isCurrent ? `${tile.name} (current)` : tile.name },
				});
				const thumb = button.createEl('img', {
					cls: 'vpahexcrawl-terrain-thumb',
					attr: { src: tile.url, alt: '', width: '64', height: '64' },
				});
				thumb.setAttr('draggable', 'false');
				button.createSpan({ text: tile.name, cls: 'vpahexcrawl-terrain-name' });
				button.addEventListener('click', () => {
					this.onPick(tileId);
					this.close();
				});
			}
		};
		renderList();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
