import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import type { Task } from '../types';
import {
	parseTodos,
	getFoodForDay,
	getExerciseForDay,
} from './todosParser';
import { sampleForScope } from './taskSampler';
import { dayShort, dayLong, formatDate } from './dateUtils';

/** Resolves {{year}} in a folder path to the current year. */
export function resolveFolder(path: string, date: moment.Moment): string {
	return path.replace('{{year}}', String(date.year()));
}

/** Reads the TODOs file from the vault. */
async function readTodosFile(
	app: App,
	settings: GreatDaySettings,
): Promise<string> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.todosFilePath),
	);
	if (!file || !(file instanceof TFile)) {
		new Notice(
			'Great day: todos file not found at "' + settings.todosFilePath + '". Create it or update the path in settings.',
		);
		return '';
	}
	return app.vault.read(file);
}

/** Parses a food table row like `| **Wed** | Chana... | Wheat pasta... |` into lunch/dinner. */
function parseFoodRow(row: string): { lunch: string; dinner: string } | null {
	const cells = row.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
	if (cells.length < 3) return null;
	// First cell is the day, second is lunch, third is dinner
	return {
		lunch: cells[1] ?? '',
		dinner: cells[2] ?? '',
	};
}

/** Extracts exercise items as a flat list (skipping heading lines like "Monday to Friday:"). */
function extractExerciseItems(exerciseText: string): string[] {
	const lines = exerciseText.split('\n');
	const items: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// Skip lines that look like section headers (end with colon, no dash)
		if (trimmed.endsWith(':') && !trimmed.startsWith('-')) continue;
		// Strip leading "- " if present
		const text = trimmed.replace(/^-\s*/, '');
		if (text) items.push(text);
	}
	return items;
}

/** Formats a task and its children as checkbox lines with proper indentation. */
function formatTaskLines(tasks: Task[], startIndent: number): string[] {
	const lines: string[] = [];
	for (const task of tasks) {
		const indent = '\t'.repeat(startIndent + (task.indent > 0 ? 1 : 0));
		const checkbox = task.done ? '- [x]' : '- [ ]';
		lines.push(`${indent}${checkbox} ${task.text}`);
	}
	return lines;
}

/** Generates the daily note content. */
export async function generateDailyNoteContent(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
): Promise<string> {
	const raw = await readTodosFile(app, settings);
	if (!raw) return '';

	const data = parseTodos(raw);
	const dayName = dayShort(date);
	const fullDayName = dayLong(date);

	const lines: string[] = [];

	// Header
	lines.push('# TODOs');

	// Exercise
	const exerciseText = getExerciseForDay(data.exercisePlanText, fullDayName);
	if (exerciseText) {
		const exerciseItems = extractExerciseItems(exerciseText);
		lines.push('- [ ] Exercise');
		for (const item of exerciseItems) {
			lines.push(`\t- [ ] ${item}`);
		}
	}

	// Food
	const foodRow = getFoodForDay(data.foodPlanLines, dayName);
	if (foodRow) {
		const parsed = parseFoodRow(foodRow);
		lines.push('- [ ] Food');
		if (parsed) {
			lines.push(`\t- [ ] Lunch: ${parsed.lunch}`);
			lines.push(`\t- [ ] Dinner: ${parsed.dinner}`);
		}
	}

	// Tasks: combine day, sampled week, sampled month, sampled year
	const dayTasks = data.tasks.day.filter((t) => !t.done);
	const weekTasks = sampleForScope(data.tasks.week, 'week', date);
	const monthTasks = sampleForScope(data.tasks.month, 'month', date);
	const yearTasks = sampleForScope(data.tasks.year, 'year', date);

	const allTasks = [...dayTasks, ...weekTasks, ...monthTasks, ...yearTasks];
	if (allTasks.length > 0) {
		lines.push('- [ ] Tasks');
		// Day tasks at indent 1
		if (dayTasks.length > 0) {
			for (const line of formatTaskLines(dayTasks, 1)) {
				lines.push(line);
			}
		}
		// Week tasks at indent 1
		if (weekTasks.length > 0) {
			for (const line of formatTaskLines(weekTasks, 1)) {
				lines.push(line);
			}
		}
		// Month tasks at indent 1
		if (monthTasks.length > 0) {
			for (const line of formatTaskLines(monthTasks, 1)) {
				lines.push(line);
			}
		}
		// Year tasks at indent 1
		if (yearTasks.length > 0) {
			for (const line of formatTaskLines(yearTasks, 1)) {
				lines.push(line);
			}
		}
	}

	// Weekly review task
	if (settings.weeklyReview && date.day() === settings.weeklyReviewDay) {
		lines.push('- [ ] Review and update TODOs');
	}

	// New tasks section
	lines.push(`## ${settings.addTasksHeading}`);
	lines.push('- [ ] ');
	lines.push('');
	lines.push('---');

	return lines.join('\n') + '\n';
}

/** Creates or opens the daily note for the given date. */
export async function createDailyNote(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
): Promise<TFile | null> {
	const dateStr = formatDate(date, settings.dateFormat);
	const folder = normalizePath(resolveFolder(settings.dailyNotesFolder, date));
	const filePath = normalizePath(`${folder}/${dateStr}.md`);

	// Check if file already exists
	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing && existing instanceof TFile) {
		new Notice('Great day: daily note already exists, opening it.');
		await app.workspace.openLinkText(filePath, '', false);
		return existing;
	}

	// Ensure folder exists by creating a placeholder file
	const folderExists = app.vault.getAbstractFileByPath(folder);
	if (!folderExists) {
		await app.vault.create(folder + '/.gitkeep', '');
	}

	// Generate content
	const content = await generateDailyNoteContent(app, settings, date);
	const file = await app.vault.create(filePath, content);
	await app.workspace.openLinkText(filePath, '', false);
	return file;
}

/** Gets the daily note file for a given date (or null if it doesn't exist). */
export function getDailyNoteFile(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
): TFile | null {
	const dateStr = formatDate(date, settings.dateFormat);
	const folder = normalizePath(resolveFolder(settings.dailyNotesFolder, date));
	const filePath = normalizePath(`${folder}/${dateStr}.md`);
	const file = app.vault.getAbstractFileByPath(filePath);
	if (file && file instanceof TFile) return file;
	return null;
}
