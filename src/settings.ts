import { App, PluginSettingTab, Setting } from 'obsidian';
import type GreatDayPlugin from './main';

export interface GreatDaySettings {
	todosFilePath: string;
	dailyNotesFolder: string;
	dateFormat: string;
	weeklyReview: boolean;
	weeklyReviewDay: number;
	addTasksHeading: string;
	icsCalendarUrl: string;
}

export const DEFAULT_SETTINGS: GreatDaySettings = {
	todosFilePath: 'TODOs.md',
	dailyNotesFolder: 'Daily Notes/{{year}}',
	dateFormat: 'YYYY-MM-DD',
	weeklyReview: true,
	weeklyReviewDay: 1,
	addTasksHeading: 'New tasks',
	icsCalendarUrl: '',
};

export class GreatDaySettingTab extends PluginSettingTab {
	plugin: GreatDayPlugin;

	constructor(app: App, plugin: GreatDayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Todos file path')
			.setDesc('Path to your todos file (relative to vault root).')
			.addText((text) =>
				text
					.setPlaceholder('TODOs.md')
					.setValue(this.plugin.settings.todosFilePath)
					.onChange(async (value) => {
						this.plugin.settings.todosFilePath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Daily notes folder')
			.setDesc('Folder where daily notes are stored. Use {{year}} for the current year.')
			.addText((text) =>
				text
					.setPlaceholder('Daily Notes/{{year}}')
					.setValue(this.plugin.settings.dailyNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Date format')
			.setDesc('Moment.js date format for daily note filenames.')
			.addText((text) =>
				text
					.setPlaceholder('Date format')
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Weekly todos review')
			.setDesc('Add a manual todos review task on a specific day each week.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.weeklyReview)
					.onChange(async (value) => {
						this.plugin.settings.weeklyReview = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Weekly review day')
			.setDesc('Day of week for the review task (0=sun, 1=mon, … 6=sat).')
			.addText((text) =>
				text
					.setPlaceholder('1')
					.setValue(String(this.plugin.settings.weeklyReviewDay))
					.onChange(async (value) => {
						this.plugin.settings.weeklyReviewDay = parseInt(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('New tasks heading')
			.setDesc('Heading text for the section where you add new tasks in daily notes.')
			.addText((text) =>
				text
					.setPlaceholder('New tasks')
					.setValue(this.plugin.settings.addTasksHeading)
					.onChange(async (value) => {
						this.plugin.settings.addTasksHeading = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Google calendar ics URL')
			.setDesc('Secret ics address from Google calendar settings. Leave empty to disable.')
			.addText((text) =>
				text
					.setPlaceholder('Calendar ics URL')
					.setValue(this.plugin.settings.icsCalendarUrl)
					.onChange(async (value) => {
						this.plugin.settings.icsCalendarUrl = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
