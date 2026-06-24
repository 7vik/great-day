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

/**
 * Syncs yesterday's daily note back to TODOs:
 * - Checked pulled tasks → removed from TODOs
 * - Unchecked pulled tasks → stay in TODOs (rolled back)
 * - New tasks with (D)/(W)/(M)/(Y) tags → appended to the right TODOs section
 * - New tasks with (DD-MM-YYYY) tags → appended to # Scheduled
 */
export async function syncRollover(
	app: App,
	settings: GreatDaySettings,
	yesterday: moment.Moment,
): Promise<SyncResult> {
	const dailyFile = getDailyNoteFile(app, settings, yesterday);
	if (!dailyFile) {
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [], scheduled: [] } };
	}

	const dailyContent = await app.vault.read(dailyFile);
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

	// Collect rolledBack (unchecked pulled tasks)
	for (const task of parsed.pulledTasks) {
		if (!task.done) {
			result.rolledBack.push(task.text);
		}
	}

	return result;
}
