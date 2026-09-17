import { Notice, Plugin, moment } from 'obsidian';
import {
	GreatDaySettings,
	DEFAULT_SETTINGS,
	GreatDaySettingTab,
} from './settings';
import { registerCommands } from './commands';
import { syncPreviousNotes, syncRollover } from './utils/rollover';
import type { SyncResult } from './types';

export default class GreatDayPlugin extends Plugin {
	settings!: GreatDaySettings;
	private observedDate = '';
	private pendingSync: Promise<SyncResult> | null = null;

	async onload() {
		await this.loadSettings();
		this.observedDate = moment().format('YYYY-MM-DD');
		registerCommands(this);
		this.addSettingTab(new GreatDaySettingTab(this.app, this));
		this.registerInterval(
			window.setInterval(() => this.checkForMidnight(), 60_000),
		);
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.autoRolloverAtMidnight) {
				void this.syncPendingNotes(moment()).catch((error: unknown) => {
					console.error('Great day: automatic rollover failed', error);
				});
			}
		});
	}

	async loadSettings() {
		this.settings = {
			...DEFAULT_SETTINGS,
			...(await this.loadData()) as Partial<GreatDaySettings>,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncPendingNotes(targetDate: moment.Moment): Promise<SyncResult> {
		if (this.pendingSync) return this.pendingSync;

		this.pendingSync = this.runPendingSync(targetDate);
		try {
			return await this.pendingSync;
		} finally {
			this.pendingSync = null;
		}
	}

	async endDay(noteDate: moment.Moment): Promise<SyncResult> {
		return syncRollover(this.app, this.settings, noteDate, moment());
	}

	private async runPendingSync(targetDate: moment.Moment): Promise<SyncResult> {
		const result = await syncPreviousNotes(
			this.app,
			this.settings,
			targetDate,
			this.settings.lastSuccessfulSyncDate || null,
		);
		const syncedThrough = targetDate.clone().subtract(1, 'day').format('YYYY-MM-DD');
		if (
			result.canAdvanceCursor &&
			(!this.settings.lastSuccessfulSyncDate || syncedThrough > this.settings.lastSuccessfulSyncDate)
		) {
			this.settings.lastSuccessfulSyncDate = syncedThrough;
			await this.saveSettings();
		}
		return result;
	}

	private checkForMidnight(): void {
		const currentDate = moment().format('YYYY-MM-DD');
		if (currentDate === this.observedDate) return;
		this.observedDate = currentDate;
		if (!this.settings.autoRolloverAtMidnight) return;

		void this.syncPendingNotes(moment()).catch((error: unknown) => {
			console.error('Great day: automatic rollover failed', error);
			new Notice('Great day: automatic rollover failed.');
		});
	}
}
