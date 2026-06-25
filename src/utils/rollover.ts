import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import type { TaskScope, SyncResult } from '../types';
import {
	parseTodos,
	extractNewTaskTag,
	stripTag,
	extractDateTag,
	stripDateTag,
	serialiseTodos,
} from './todosParser';
import { getDailyNoteFile } from './dailyNoteGenerator';

/** Marker written at the end of a daily note after rollover to prevent double-sync. */
const SYNCED_MARKER = '<!-- great-day-synced -->';

/** Matches a checkbox task line. */
const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

/** A parsed task from the daily note. */
interface ParsedTask {
	raw: string;
	done: boolean;
	text: string;
	indent: number;
}

/** Result of parsing a daily note. */
interface DailyNoteTasks {
	pulledTasks: ParsedTask[];
	newTasks: ParsedTask[];
}

/** Parses a daily note's content into pulled tasks and new tasks. */
function parseDailyNote(
	content: string,
	settings: GreatDaySettings,
): DailyNoteTasks {
	const lines = content.split('\n');
	const pulledTasks: ParsedTask[] = [];
	const newTasks: ParsedTask[] = [];

	let inNewTasksSection = false;
	let inTasksSection = false;

	for (const line of lines) {
		const trimmedLower = line.trim().toLowerCase();
		const headingMatch = trimmedLower.match(/^#+\s+(.+)$/);

		if (headingMatch) {
			const headingText = headingMatch[1] ?? '';
			inNewTasksSection = headingText === settings.addTasksHeading.toLowerCase();
			inTasksSection = false;
			continue;
		}

		const taskMatch = line.match(TASK_RE);
		if (taskMatch) {
			const indentStr = taskMatch[1] ?? '';
			const doneChar = taskMatch[2] ?? ' ';
			const text = taskMatch[3] ?? '';
			const indent = indentStr.replace(/\t/g, '    ').length;
			const taskObj: ParsedTask = {
				raw: line,
				done: doneChar.toLowerCase() === 'x',
				text,
				indent,
			};

			if (inNewTasksSection) {
				newTasks.push(taskObj);
			} else if (inTasksSection) {
				if (indent > 0) {
					pulledTasks.push(taskObj);
				}
			} else {
				if (trimmedLower === '- [ ] tasks' || trimmedLower === '- [x] tasks') {
					inTasksSection = true;
				}
			}
		} else {
			if (inTasksSection && trimmedLower === '') {
				inTasksSection = false;
			}
		}
	}

	return { pulledTasks, newTasks };
}

/** Checks whether a daily note has already been synced. */
export function isNoteSynced(content: string): boolean {
	return content.includes(SYNCED_MARKER);
}

/**
 * Finds the most recent previous daily note that hasn't been synced yet.
 * Searches backwards from the given date (up to 30 days).
 */
export function findUnsyncedNote(
	app: App,
	settings: GreatDaySettings,
	targetDate: moment.Moment,
): { date: moment.Moment; file: TFile } | null {
	for (let i = 1; i <= 30; i++) {
		const checkDate = targetDate.clone().subtract(i, 'day');
		const file = getDailyNoteFile(app, settings, checkDate);
		if (!file) continue;

		// We need to read the file to check the marker, but we can't do async here.
		// Instead, return the first existing file — the caller will check the marker.
		return { date: checkDate, file };
	}
	return null;
}

/**
 * Syncs a daily note back to TODOs:
 * - Checked pulled tasks → removed from TODOs
 * - Unchecked pulled tasks → stay in TODOs (rolled back)
 * - New tasks with (D)/(W)/(M)/(Y) tags → appended to the right TODOs section
 * - New tasks with (DD-MM-YYYY) tags → appended to # Scheduled
 * Marks the note as synced to prevent double-processing.
 */
export async function syncRollover(
	app: App,
	settings: GreatDaySettings,
	noteDate: moment.Moment,
): Promise<SyncResult> {
	const dailyFile = getDailyNoteFile(app, settings, noteDate);
	if (!dailyFile) {
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [], scheduled: [] } };
	}

	const dailyContent = await app.vault.read(dailyFile);

	// Skip if already synced (idempotency)
	if (isNoteSynced(dailyContent)) {
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [], scheduled: [] } };
	}

	const parsed = parseDailyNote(dailyContent, settings);

	const todosFile = app.vault.getAbstractFileByPath(
		normalizePath(settings.todosFilePath),
	);
	if (!todosFile || !(todosFile instanceof TFile)) {
		new Notice('Great day: todos file not found for rollover sync.');
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [], scheduled: [] } };
	}

	const todosRaw = await app.vault.read(todosFile);
	const data = parseTodos(todosRaw);

	const result: SyncResult = {
		rolledBack: [],
		completed: [],
		appended: { day: [], week: [], month: [], year: [], scheduled: [] },
	};

	// Collect texts of completed tasks from the daily note
	const completedTexts = new Set<string>();
	for (const task of parsed.pulledTasks) {
		if (task.done) {
			completedTexts.add(task.text);
		}
	}

	// Remove completed tasks from TODOs (also remove their sub-tasks)
	for (const scope of ['day', 'week', 'month', 'year', 'scheduled'] as TaskScope[]) {
		const indicesToRemove = new Set<number>();
		for (let i = 0; i < data.tasks[scope].length; i++) {
			const task = data.tasks[scope][i]!;
			if (completedTexts.has(task.text)) {
				indicesToRemove.add(i);
				result.completed.push(task.text);
				for (let j = i + 1; j < data.tasks[scope].length; j++) {
					const subTask = data.tasks[scope][j]!;
					if (subTask.indent > task.indent) {
						indicesToRemove.add(j);
					} else {
						break;
					}
				}
			}
		}
		data.tasks[scope] = data.tasks[scope].filter(
			(_, idx) => !indicesToRemove.has(idx),
		);
	}

	// Process new tasks: append to appropriate section
	for (const task of parsed.newTasks) {
		if (task.done) continue;
		if (!task.text.trim()) continue;

		// Check for date tag first (DD-MM-YYYY)
		const dateTag = extractDateTag(task.text);
		if (dateTag) {
			const cleanText = stripDateTag(task.text);
			data.tasks.scheduled.push({
				raw: `- [ ] ${cleanText} (${dateTag})`,
				text: cleanText,
				done: false,
				scope: 'scheduled',
				indent: 0,
				scheduledDate: dateTag,
			});
			result.appended.scheduled.push(cleanText);
			continue;
		}

		// Check for scope tag (D/W/M/Y)
		const tagResult = extractNewTaskTag(task.text);
		if (tagResult) {
			const cleanText = stripTag(task.text);
			data.tasks[tagResult.scope].push({
				raw: `- [ ] ${cleanText}`,
				text: cleanText,
				done: false,
				scope: tagResult.scope,
				indent: 0,
				scheduledDate: null,
			});
			result.appended[tagResult.scope].push(cleanText);
		}
	}

	// Write back TODOs
	const newTodos = serialiseTodos(data);
	await app.vault.modify(todosFile, newTodos);

	// Mark the daily note as synced
	const updatedContent = dailyContent.trimEnd() + '\n\n' + SYNCED_MARKER + '\n';
	await app.vault.modify(dailyFile, updatedContent);

	// Collect rolledBack (unchecked pulled tasks)
	for (const task of parsed.pulledTasks) {
		if (!task.done) {
			result.rolledBack.push(task.text);
		}
	}

	return result;
}

/**
 * Syncs all unsynced previous daily notes before creating a new one.
 * Returns the combined result of all syncs.
 */
export async function syncPreviousNotes(
	app: App,
	settings: GreatDaySettings,
	targetDate: moment.Moment,
): Promise<SyncResult> {
	const combined: SyncResult = {
		rolledBack: [],
		completed: [],
		appended: { day: [], week: [], month: [], year: [], scheduled: [] },
	};

	for (let i = 1; i <= 30; i++) {
		const checkDate = targetDate.clone().subtract(i, 'day');
		const file = getDailyNoteFile(app, settings, checkDate);
		if (!file) continue;

		const content = await app.vault.read(file);
		if (isNoteSynced(content)) break; // Stop at first synced note

		const result = await syncRollover(app, settings, checkDate);
		combined.rolledBack.push(...result.rolledBack);
		combined.completed.push(...result.completed);
		combined.appended.day.push(...result.appended.day);
		combined.appended.week.push(...result.appended.week);
		combined.appended.month.push(...result.appended.month);
		combined.appended.year.push(...result.appended.year);
		combined.appended.scheduled.push(...result.appended.scheduled);
	}

	return combined;
}
