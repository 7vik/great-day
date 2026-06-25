import { Plugin } from 'obsidian';
import {
	GreatDaySettings,
	DEFAULT_SETTINGS,
	GreatDaySettingTab,
} from './settings';
import { registerCommands } from './commands';

export default class GreatDayPlugin extends Plugin {
	settings!: GreatDaySettings;

	async onload() {
		await this.loadSettings();
		registerCommands(this);
		this.addSettingTab(new GreatDaySettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<GreatDaySettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
