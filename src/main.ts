import { Plugin, Notice, moment } from 'obsidian';
import {
	GreatDaySettings,
	DEFAULT_SETTINGS,
	GreatDaySettingTab,
} from './settings';
import { registerCommands } from './commands';
import { syncRollover } from './utils/rollover';

export default class GreatDayPlugin extends Plugin {
	settings!: GreatDaySettings;
	private rolloverIntervalId: number | null = null;
	private lastRolloverDate: string = '';

	async onload() {
		await this.loadSettings();

		// Register commands
		registerCommands(this);

		// Settings tab
		this.addSettingTab(new GreatDaySettingTab(this.app, this));

		// Run rollover on load (handles the case where Obsidian was closed overnight)
		if (this.settings.autoRollover) {
			void void this.runRolloverIfNeeded();
		}

		// Start the midnight timer
		this.startRolloverTimer();
	}

	onunload() {
		if (this.rolloverIntervalId !== null) {
			window.clearInterval(this.rolloverIntervalId);
			this.rolloverIntervalId = null;
		}
	}

	/** Checks whether a rollover is needed (date changed since last run) and runs it. */
	private async runRolloverIfNeeded(): Promise<void> {
		const today = moment().format('YYYY-MM-DD');
		if (this.lastRolloverDate === today) return;
		this.lastRolloverDate = today;

		const yesterday = moment().subtract(1, 'day');
		const result = await syncRollover(this.app, this.settings, yesterday);
		const totalAppended =
			result.appended.day.length +
			result.appended.week.length +
			result.appended.month.length +
			result.appended.year.length;
		if (result.completed.length > 0 || result.rolledBack.length > 0 || totalAppended > 0) {
			new Notice(
				`Great Day: Midnight sync — ${result.completed.length} completed, ${result.rolledBack.length} rolled back, ${totalAppended} new.`,
			);
		}
	}

	/** Starts a timer that checks every minute whether midnight has passed. */
	private startRolloverTimer(): void {
		if (!this.settings.autoRollover) return;

		this.rolloverIntervalId = window.setInterval(() => {
			void this.runRolloverIfNeeded();
		}, 60 * 1000);

		this.registerInterval(this.rolloverIntervalId);
	}

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
