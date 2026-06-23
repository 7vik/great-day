import { App, PluginSettingTab, Setting } from 'obsidian';
import type GreatDayPlugin from './main';

export interface GreatDaySettings {
	/** Path to the TODOs file (relative to vault root). */
	todosFilePath: string;
	/** Folder where daily notes are stored (relative to vault root). */
	dailyNotesFolder: string;
	/** Date format for daily note filenames (moment.js format). */
	dateFormat: string;
	/** Number of week tasks to sample into each daily note. */
	weekTaskCount: number;
	/** Number of month tasks to sample into each daily note. */
	monthTaskCount: number;
	/** Number of year tasks to sample into each daily note. */
	yearTaskCount: number;
	/** Whether to auto-sync at midnight. */
	autoRollover: boolean;
	/** Whether to add a weekly TODOs review task on a specific day. */
	weeklyReview: boolean;
	/** Day of week for weekly review (0=Sun … 6=Sat). */
	weeklyReviewDay: number;
	/** Heading text for the "add tasks" section in daily notes. */
	addTasksHeading: string;
}

export const DEFAULT_SETTINGS: GreatDaySettings = {
	todosFilePath: 'TODOs.md',
	dailyNotesFolder: 'Daily Notes',
	dateFormat: 'YYYY-MM-DD',
	weekTaskCount: 4,
	monthTaskCount: 3,
	yearTaskCount: 2,
	autoRollover: true,
	weeklyReview: true,
	weeklyReviewDay: 1,
	addTasksHeading: 'New tasks',
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
			.setDesc('Folder where daily notes are stored.')
			.addText((text) =>
				text
					.setPlaceholder('Daily notes')
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
			.setName('Week tasks to show')
			.setDesc('How many week-scope tasks to sample into each daily note.')
			.addText((text) =>
				text
					.setPlaceholder('4')
					.setValue(String(this.plugin.settings.weekTaskCount))
					.onChange(async (value) => {
						this.plugin.settings.weekTaskCount = parseInt(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Month tasks to show')
			.setDesc('How many month-scope tasks to sample into each daily note.')
			.addText((text) =>
				text
					.setPlaceholder('3')
					.setValue(String(this.plugin.settings.monthTaskCount))
					.onChange(async (value) => {
						this.plugin.settings.monthTaskCount = parseInt(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Year tasks to show')
			.setDesc('How many year-scope tasks to sample into each daily note.')
			.addText((text) =>
				text
					.setPlaceholder('2')
					.setValue(String(this.plugin.settings.yearTaskCount))
					.onChange(async (value) => {
						this.plugin.settings.yearTaskCount = parseInt(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Auto rollover at midnight')
			.setDesc('Automatically sync uncompleted tasks back to todos at midnight.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoRollover)
					.onChange(async (value) => {
						this.plugin.settings.autoRollover = value;
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
	}
}
