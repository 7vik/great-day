import type GreatDayPlugin from '../main';
import { Notice, moment } from 'obsidian';
import { createDailyNote } from '../utils/dailyNoteGenerator';
import { syncRollover } from '../utils/rollover';
import type { SyncResult } from '../types';

/** Shows a summary notice of the rollover result. */
function showRolloverNotice(result: SyncResult): void {
	const totalAppended =
		result.appended.day.length +
		result.appended.week.length +
		result.appended.month.length +
		result.appended.year.length +
		result.appended.scheduled.length;
	new Notice(
		`Great day: synced — ${result.completed.length} completed, ${result.rolledBack.length} rolled back, ${totalAppended} new task(s) added to todos.`,
	);
}

/** Registers all plugin commands. */
export function registerCommands(plugin: GreatDayPlugin): void {
	plugin.addCommand({
		id: 'create-today-daily-note',
		name: 'Create today\'s daily note',
		callback: async () => {
			await createDailyNote(plugin.app, plugin.settings, moment());
		},
	});

	plugin.addCommand({
		id: 'sync-yesterday-rollover',
		name: 'Sync yesterday\'s tasks back to todos',
		callback: async () => {
			const yesterday = moment().subtract(1, 'day');
			const result = await syncRollover(plugin.app, plugin.settings, yesterday);
			showRolloverNotice(result);
		},
	});

	plugin.addCommand({
		id: 'end-day',
		name: 'End day',
		callback: async () => {
			const result = await syncRollover(plugin.app, plugin.settings, moment());
			showRolloverNotice(result);
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
					await createDailyNote(plugin.app, plugin.settings, date);
				} else {
					new Notice('Great day: invalid date format.');
				}
			}
		},
	});
}
