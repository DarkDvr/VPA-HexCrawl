import { Modal, type App } from 'obsidian';
import { MAX_HEX_TEXT_LENGTH, sanitizeHexText } from './data';

export interface HexNameModalOptions {
	title: string;
	initialText: string;
	onSave: (text: string) => void;
}

export class HexNameModal extends Modal {
	private initialText: string;
	private modalTitle: string;
	private onSave: (text: string) => void;

	constructor(app: App, options: HexNameModalOptions) {
		super(app);
		this.modalTitle = options.title;
		this.initialText = options.initialText;
		this.onSave = options.onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vpahexcrawl-name-modal');
		contentEl.createEl('h2', { text: this.modalTitle, cls: 'vpahexcrawl-name-title' });
		const input = contentEl.createEl('input', {
			cls: 'vpahexcrawl-name-input',
			attr: {
				type: 'text',
				maxlength: String(MAX_HEX_TEXT_LENGTH),
				placeholder: 'Enter name',
				'aria-label': 'Hex name',
				value: this.initialText,
			},
		});
		input.focus();
		input.select();
		const buttonRow = contentEl.createDiv({ cls: 'vpahexcrawl-name-buttons' });
		const saveButton = buttonRow.createEl('button', { text: 'Save', cls: 'vpahexcrawl-name-save' });
		saveButton.setAttr('aria-label', 'Save hex name');
		const cancelButton = buttonRow.createEl('button', { text: 'Cancel' });
		cancelButton.setAttr('aria-label', 'Cancel hex name change');
		const submit = (): void => {
			const cleaned = sanitizeHexText(input.value);
			this.onSave(cleaned);
			this.close();
		};
		saveButton.addEventListener('click', () => {
			submit();
		});
		cancelButton.addEventListener('click', () => {
			this.close();
		});
		input.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				submit();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
