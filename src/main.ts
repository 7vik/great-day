import { Notice, Plugin, TFile, moment, normalizePath } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import {
	GreatDaySettings,
	DEFAULT_SETTINGS,
	GreatDaySettingTab,
} from './settings';
import { registerCommands } from './commands';
import { selectPendingNoteDates, syncPreviousNotes, syncRollover } from './utils/rollover';
import { addTasksToNote } from './utils/dailyNoteGenerator';
import type { SyncResult } from './types';

export default class GreatDayPlugin extends Plugin {
	settings!: GreatDaySettings;
	private observedDate = '';
	private pendingSync: Promise<SyncResult> | null = null;
	private resyncTimer: number | null = null;
	/** Ignore vault events until this time — they're echoes of our own writes. */
	private ignoreEventsUntil = 0;

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
			// Obsidian Sync can deliver another device's edits to a past daily
			// note (or to TODOs.md) *after* this device has already synced it —
			// e.g. tasks added last night on the phone arrive minutes after the
			// laptop opened and generated today's note. Resync whenever that
			// happens so late-arriving tasks still land in TODOs and today's note.
			this.registerEvent(this.app.vault.on('modify', (file) => this.onVaultChange(file)));
			this.registerEvent(this.app.vault.on('create', (file) => this.onVaultChange(file)));
		});
	}

	onunload() {
		if (this.resyncTimer !== null) window.clearTimeout(this.resyncTimer);
	}

	private onVaultChange(file: TAbstractFile): void {
		if (!this.settings.autoRolloverAtMidnight) return;
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (this.pendingSync || Date.now() < this.ignoreEventsUntil) return;

		const isTodos = file.path === normalizePath(this.settings.todosFilePath);
		const isRecentPastNote = selectPendingNoteDates(
			[file.path], this.settings, moment(), null,
		).length > 0;
		if (!isTodos && !isRecentPastNote) return;

		// Debounce: sync writes files in bursts, and so does typing.
		if (this.resyncTimer !== null) window.clearTimeout(this.resyncTimer);
		this.resyncTimer = window.setTimeout(() => {
			this.resyncTimer = null;
			void this.syncPendingNotes(moment()).catch((error: unknown) => {
				console.error('Great day: background resync failed', error);
			});
		}, 10_000);
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
			this.ignoreEventsUntil = Date.now() + 2_000;
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

		// If the target day's note already exists (generated before these tasks
		// arrived), add the newly ingested day tasks to it directly.
		if (result.todos) {
			const newTexts = new Set([...result.appended.day, ...result.appended.scheduled]);
			const lateTasks = result.todos.tasks.day.filter(
				(task) => !task.done && task.indent === 0 && newTexts.has(task.text),
			);
			const added = await addTasksToNote(this.app, this.settings, targetDate, lateTasks);
			if (added.length > 0) {
				new Notice(`Great day: added ${added.length} late-synced task(s) to today's note.`);
			}
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
