import type GreatDayPlugin from '../main';
import { Notice, moment } from 'obsidian';
import { createDailyNote } from '../utils/dailyNoteGenerator';

function showSyncResult(result: Awaited<ReturnType<GreatDayPlugin['endDay']>>): void {
	const totalAppended = Object.values(result.appended)
		.reduce((total, tasks) => total + tasks.length, 0);
	if (result.completed.length === 0 && result.rolledBack.length === 0 && totalAppended === 0) {
		new Notice('Great day: nothing to sync.');
		return;
	}
	new Notice(
		`Great day: synced — ${result.completed.length} completed, ${result.rolledBack.length} rolled back, ${totalAppended} new.`,
	);
}

/** Registers all plugin commands. */
export function registerCommands(plugin: GreatDayPlugin): void {
	plugin.addCommand({
		id: 'create-today-daily-note',
		name: 'Create today\'s daily note',
		callback: async () => {
			await createDailyNote(plugin, moment());
		},
	});

	plugin.addCommand({
		id: 'create-daily-note-date',
		name: 'Create daily note for…',
		callback: async () => {
			// eslint-disable-next-line no-alert
			const dateStr = window.prompt(
				`Enter date (format: ${plugin.settings.dateFormat})`,
				moment().format(plugin.settings.dateFormat),
			);
			if (dateStr) {
				const date = moment(dateStr, plugin.settings.dateFormat);
				if (date.isValid()) {
					await createDailyNote(plugin, date);
				} else {
					new Notice('Great day: invalid date format.');
				}
			}
		},
	});

	plugin.addCommand({
		id: 'end-day',
		name: 'End day',
		callback: async () => {
			showSyncResult(await plugin.endDay(moment()));
		},
	});

	plugin.addCommand({
		id: 'sync-previous-day',
		name: 'Sync yesterday\'s tasks back to todos',
		callback: async () => {
			const yesterday = moment().subtract(1, 'day');
			showSyncResult(await plugin.endDay(yesterday));
		},
	});
}
