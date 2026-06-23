import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import type { TaskScope, SyncResult } from '../types';
import { parseTodos, extractNewTaskTag, stripTag, serialiseTodos } from './todosParser';
import { getDailyNoteFile } from './dailyNoteGenerator';

/** Matches a checkbox task line. */
const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

/** A parsed task from the daily note. */
interface ParsedTask {
	raw: string;
	done: boolean;
	text: string;
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

	for (const line of lines) {
		const trimmedLower = line.trim().toLowerCase();
		const headingMatch = trimmedLower.match(/^#+\s+(.+)$/);

		if (headingMatch) {
			const headingText = headingMatch[1] ?? '';
			inNewTasksSection = headingText === settings.addTasksHeading.toLowerCase();
			continue;
		}

		const taskMatch = line.match(TASK_RE);
		if (taskMatch) {
			const doneChar = taskMatch[2] ?? ' ';
			const text = taskMatch[3] ?? '';
			const taskObj: ParsedTask = {
				raw: line,
				done: doneChar.toLowerCase() === 'x',
				text,
			};
			if (inNewTasksSection) {
				newTasks.push(taskObj);
			} else {
				pulledTasks.push(taskObj);
			}
		}
	}

	return { pulledTasks, newTasks };
}

/**
 * Syncs yesterday's daily note back to TODOs:
 * - Checked pulled tasks → mark as done in TODOs
 * - Unchecked pulled tasks → stay in TODOs (rolled back)
 * - New tasks with (D)/(W)/(M)/(Y) tags → append to the right TODOs section
 */
export async function syncRollover(
	app: App,
	settings: GreatDaySettings,
	yesterday: moment.Moment,
): Promise<SyncResult> {
	const dailyFile = getDailyNoteFile(app, settings, yesterday);
	if (!dailyFile) {
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [] } };
	}

	const dailyContent = await app.vault.read(dailyFile);
	const parsed = parseDailyNote(dailyContent, settings);

	const todosFile = app.vault.getAbstractFileByPath(
		normalizePath(settings.todosFilePath),
	);
	if (!todosFile || !(todosFile instanceof TFile)) {
		new Notice('Great day: todos file not found for rollover sync.');
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [] } };
	}

	const todosRaw = await app.vault.read(todosFile);
	const data = parseTodos(todosRaw);

	const result: SyncResult = {
		rolledBack: [],
		completed: [],
		appended: { day: [], week: [], month: [], year: [] },
	};

	// Process pulled tasks
	for (const task of parsed.pulledTasks) {
		for (const scope of ['day', 'week', 'month', 'year'] as TaskScope[]) {
			const idx = data.tasks[scope].findIndex(
				(t) => t.text === task.text,
			);
			if (idx >= 0) {
				if (task.done) {
					data.tasks[scope][idx]!.done = true;
					data.tasks[scope][idx]!.raw = data.tasks[scope][idx]!.raw.replace(
						'- [ ]', '- [x]',
					);
					result.completed.push(task.text);
				}
				break;
			}
		}
	}

	// Process new tasks: append to appropriate section
	for (const task of parsed.newTasks) {
		if (task.done) continue;
		const tagResult = extractNewTaskTag(task.text);
		if (tagResult) {
			const cleanText = stripTag(task.text);
			const newRaw = `- [ ] ${cleanText}`;
			data.tasks[tagResult.scope].push({
				raw: newRaw,
				text: cleanText,
				done: false,
				scope: tagResult.scope,
				indent: 0,
			});
			result.appended[tagResult.scope].push(cleanText);
		}
	}

	// Write back TODOs
	const newTodos = serialiseTodos(data);
	await app.vault.modify(todosFile, newTodos);

	// Collect rolledBack (unchecked pulled tasks)
	for (const task of parsed.pulledTasks) {
		if (!task.done) {
			result.rolledBack.push(task.text);
		}
	}

	return result;
}
