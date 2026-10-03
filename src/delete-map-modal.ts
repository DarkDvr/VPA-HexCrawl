import { Modal, type App } from 'obsidian';

export interface DeleteMapModalOptions {
	onConfirm: () => void;
}

export class DeleteMapModal extends Modal {
	private onConfirm: () => void;

	constructor(app: App, options: DeleteMapModalOptions) {
		super(app);
		this.onConfirm = options.onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vpahexcrawl-delete-modal');
		contentEl.createEl('h2', { text: 'Delete entire map', cls: 'vpahexcrawl-delete-title' });
		contentEl.createEl('p', {
			text: 'This removes every hex, name, road, river, feature, terrain choice, and the player token position. Your settings stay as they are. This cannot be undone.',
			cls: 'vpahexcrawl-delete-text',
		});
		contentEl.createEl('p', {
			text: 'Type DELETE in the box below to enable the delete button.',
			cls: 'vpahexcrawl-delete-text',
		});
		const input = contentEl.createEl('input', {
			cls: 'vpahexcrawl-delete-input',
			attr: {
				type: 'text',
				placeholder: 'DELETE',
				'aria-label': 'Type DELETE to confirm map deletion',
				autocomplete: 'off',
			},
		});
		input.focus();
		const buttonRow = contentEl.createDiv({ cls: 'vpahexcrawl-delete-buttons' });
		const deleteButton = buttonRow.createEl('button', {
			text: 'Delete entire map',
			cls: 'vpahexcrawl-delete-confirm mod-warning',
		});
		deleteButton.setAttr('aria-label', 'Delete entire map');
		deleteButton.disabled = true;
		const cancelButton = buttonRow.createEl('button', { text: 'Cancel' });
		cancelButton.setAttr('aria-label', 'Cancel map deletion');
		input.addEventListener('input', () => {
			deleteButton.disabled = input.value !== 'DELETE';
		});
		input.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter' && input.value === 'DELETE') {
				evt.preventDefault();
				this.onConfirm();
				this.close();
			}
		});
		deleteButton.addEventListener('click', () => {
			if (input.value !== 'DELETE') {
				return;
			}
			this.onConfirm();
			this.close();
		});
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
