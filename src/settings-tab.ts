import {
	FileSystemAdapter,
	Notice,
	Platform,
	PluginSettingTab,
	type App,
	type SettingDefinitionItem,
	type TFile,
} from 'obsidian';
import { DEFAULT_TUNING } from './data';
import { DeleteMapModal } from './delete-map-modal';
import { ensureTilesDir, tilesDir } from './tiles';
import type VpaHexcrawlPlugin from './main';

export class VpaHexcrawlSettingTab extends PluginSettingTab {
	private owner: VpaHexcrawlPlugin;

	constructor(app: App, owner: VpaHexcrawlPlugin) {
		super(app, owner);
		this.owner = owner;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Rivers',
				items: [
					{
						name: 'River bend',
						desc: 'How aggressively rivers bend inside each hex.',
						control: {
							type: 'slider',
							key: 'riverBend',
							min: 0,
							max: 60,
							step: 1,
							defaultValue: DEFAULT_TUNING.riverBend,
						},
					},
					{
						name: 'River blue',
						desc: 'How blue rivers look, from gray to vivid.',
						control: {
							type: 'slider',
							key: 'riverBlue',
							min: 0,
							max: 100,
							step: 1,
							defaultValue: DEFAULT_TUNING.riverBlue,
						},
					},
					{
						name: 'River width',
						desc: 'How wide rivers look.',
						control: {
							type: 'slider',
							key: 'riverWidth',
							min: 2,
							max: 14,
							step: 1,
							defaultValue: DEFAULT_TUNING.riverWidth,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Roads',
				items: [
					{
						name: 'Road bends',
						desc: 'How aggressively roads bend inside each hex.',
						control: {
							type: 'slider',
							key: 'roadChaos',
							min: 0,
							max: 30,
							step: 1,
							defaultValue: DEFAULT_TUNING.roadChaos,
						},
					},
					{
						name: 'Road width',
						desc: 'How wide roads look, in tenths of a map pixel.',
						control: {
							type: 'slider',
							key: 'roadWidth',
							min: 10,
							max: 60,
							step: 1,
							defaultValue: DEFAULT_TUNING.roadWidth,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Features',
				items: [
					{
						name: 'Feature size',
						desc: 'Feature art size as a percent of hex diameter.',
						control: {
							type: 'slider',
							key: 'featureSize',
							min: 25,
							max: 100,
							step: 1,
							defaultValue: DEFAULT_TUNING.featureSize,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Terrain',
				items: [
					{
						name: 'Art trim',
						desc: 'Pixels trimmed off the terrain art size.',
						control: {
							type: 'slider',
							key: 'artTrim',
							min: 0,
							max: 12,
							step: 1,
							defaultValue: DEFAULT_TUNING.artTrim,
						},
					},
					{
						name: 'Border width',
						desc: 'Hex edge width above terrain art, 0 hides it.',
						control: {
							type: 'slider',
							key: 'borderWidth',
							min: 0,
							max: 4,
							step: 1,
							defaultValue: DEFAULT_TUNING.borderWidth,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Names',
				items: [
					{
						name: 'Text size',
						desc: 'Settlement name size in pixels.',
						control: {
							type: 'slider',
							key: 'textSize',
							min: 6,
							max: 13,
							step: 1,
							defaultValue: DEFAULT_TUNING.textSize,
						},
					},
					{
						name: 'Text drop',
						desc: 'How far names sit below hex center, in pixels.',
						control: {
							type: 'slider',
							key: 'textDrop',
							min: 0,
							max: 20,
							step: 1,
							defaultValue: DEFAULT_TUNING.textDrop,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Player token',
				items: [
					{
						name: 'Token size',
						desc: 'Token diameter as a percent of hex radius.',
						control: {
							type: 'slider',
							key: 'tokenSize',
							min: 25,
							max: 75,
							step: 1,
							defaultValue: DEFAULT_TUNING.tokenSize,
						},
					},
					{
						name: 'Token image',
						desc: 'Portrait drawn inside your player token. Leave empty for a plain token.',
						control: {
							type: 'file',
							key: 'tokenImage',
							placeholder: 'Choose an image',
							defaultValue: '',
							filter: (file: TFile): boolean => {
								return ['png', 'jpg', 'jpeg', 'webp'].includes(file.extension.toLowerCase());
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Custom tilesets',
				items: [
					{
						name: 'Adding your own tilesets',
						desc: 'Drop a folder into the tiles folder inside this plugin folder, with terrain and features subfolders holding PNG files. Each side must measure 100 to 300 pixels and each file must stay between 10 kilobytes and 3 megabytes. Valid sets appear in your terrain and feature pickers.',
					},
					{
						name: 'Open tiles folder',
						desc: 'Opens the folder where custom tileset folders live.',
						action: (): void => {
							void (async (): Promise<void> => {
								try {
									await ensureTilesDir(this.app);
								} catch {
									// Folder creation is best effort only.
								}
								if (!Platform.isDesktop) {
									new Notice('Opening folders is only available on desktop.');
									return;
								}
								const adapter = this.app.vault.adapter;
								if (!(adapter instanceof FileSystemAdapter)) {
									new Notice('Opening folders is only available on desktop.');
									return;
								}
								const fullPath = adapter.getFullPath(tilesDir(this.app));
								const desktopRequire = (
									window as unknown as {
										require?: (id: string) => {
											shell: { openPath: (path: string) => Promise<string> };
										};
									}
								).require;
								if (desktopRequire === undefined) {
									new Notice('Could not open the tiles folder.');
									return;
								}
								try {
									const error = await desktopRequire('electron').shell.openPath(fullPath);
									if (error.length > 0) {
										new Notice('Could not open the tiles folder.');
									}
								} catch {
									new Notice('Could not open the tiles folder.');
								}
							})();
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Danger zone',
				items: [
					{
						name: 'Delete entire map',
						desc: 'Removes every hex and the player token position. Your settings stay as they are.',
						action: (): void => {
							const modal = new DeleteMapModal(this.app, {
								onConfirm: () => {
									this.owner.resetMapKeepSettings();
								},
							});
							modal.open();
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === 'tokenImage') {
			return this.owner.getTokenImagePath();
		}
		const tuning = this.owner.getTuning();
		if (key === 'riverBend') {
			return tuning.riverBend;
		}
		if (key === 'riverBlue') {
			return tuning.riverBlue;
		}
		if (key === 'riverWidth') {
			return tuning.riverWidth;
		}
		if (key === 'roadChaos') {
			return tuning.roadChaos;
		}
		if (key === 'roadWidth') {
			return tuning.roadWidth;
		}
		if (key === 'featureSize') {
			return tuning.featureSize;
		}
		if (key === 'artTrim') {
			return tuning.artTrim;
		}
		if (key === 'borderWidth') {
			return tuning.borderWidth;
		}
		if (key === 'textSize') {
			return tuning.textSize;
		}
		if (key === 'textDrop') {
			return tuning.textDrop;
		}
		if (key === 'tokenSize') {
			return tuning.tokenSize;
		}
		return undefined;
	}

	setControlValue(key: string, value: unknown): void {
		if (key === 'tokenImage') {
			if (typeof value === 'string') {
				this.owner.setTokenImage(value);
			}
			return;
		}
		if (typeof value === 'number') {
			this.owner.setTuningValue(key, value);
		}
	}
}
