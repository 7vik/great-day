import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment, requestUrl } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import type { Task } from '../types';
import {
	parseTodos,
	getFoodForDay,
	getExerciseForDay,
	getReminders,
} from './todosParser';
import { sampleForScope } from './taskSampler';
import { parseIcsForDate, type CalendarEvent } from './icsParser';
import { syncPreviousNotes } from './rollover';
import { dayShort, dayLong, formatDate } from './dateUtils';

/** Resolves {{year}} in a folder path to the current year. */
export function resolveFolder(path: string, date: moment.Moment): string {
	return path.replace('{{year}}', String(date.year()));
}

/** Checks if a date is a weekend (Saturday or Sunday). */
function isWeekend(date: moment.Moment): boolean {
	const day = date.day(); // 0=Sun, 6=Sat
	return day === 0 || day === 6;
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

/** Fetches and parses calendar events for the given date. */
async function fetchCalendarEvents(
	settings: GreatDaySettings,
	date: moment.Moment,
): Promise<CalendarEvent[]> {
	if (!settings.icsCalendarUrl) return [];
	try {
		const response = await requestUrl({
			url: settings.icsCalendarUrl,
			method: 'GET',
		});
		return parseIcsForDate(response.text, date);
	} catch {
		new Notice('Great day: failed to fetch calendar events.');
		return [];
	}
}

/** Formats calendar events as task lines. */
function formatEvents(events: CalendarEvent[]): string[] {
	const lines: string[] = [];
	for (const event of events) {
		let label = event.summary;
		if (!event.allDay) {
			const startStr = event.start.format('HH:mm');
			const endStr = event.end.format('HH:mm');
			if (startStr === endStr) {
				label = `${startStr} ${event.summary}`;
			} else {
				label = `${startStr}-${endStr} ${event.summary}`;
			}
		}
		lines.push(`\t- [ ] ${label}`);
	}
	return lines;
}

/** Parses a food table row into lunch/dinner. */
function parseFoodRow(row: string): { lunch: string; dinner: string } | null {
	const cells = row.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
	if (cells.length < 3) return null;
	return {
		lunch: cells[1] ?? '',
		dinner: cells[2] ?? '',
	};
}

/** Extracts exercise items as a flat list. */
function extractExerciseItems(exerciseText: string): string[] {
	const lines = exerciseText.split('\n');
	const items: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.endsWith(':') && !trimmed.startsWith('-')) continue;
		const text = trimmed.replace(/^-\s*/, '');
		if (text) items.push(text);
	}
	return items;
}

/** Formats a task and its children as checkbox lines. */
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
	const dateTag = date.format('DD-MM-YYYY');

	const lines: string[] = [];
	const chillWeekend = settings.chillWeekends && isWeekend(date);

	// Header
	lines.push('# TODOs');

	// Reminders (skip on chill weekends)
	if (!chillWeekend) {
	const reminders = getReminders(data.reminderLines);
	if (reminders.length > 0) {
		lines.push('- [ ] Reminders');
		for (const reminder of reminders) {
			lines.push(`\t- [ ] ${reminder}`);
		}
	}

	} // end reminders

	// Calendar events
	const events = await fetchCalendarEvents(settings, date);
	if (events.length > 0) {
		lines.push('- [ ] Calendar');
		for (const line of formatEvents(events)) {
			lines.push(line);
		}
	}

	// Exercise (skip on chill weekends)
	if (!chillWeekend) {
	const exerciseText = getExerciseForDay(data.exercisePlanText, fullDayName);
	if (exerciseText) {
		const exerciseItems = extractExerciseItems(exerciseText);
		lines.push('- [ ] Exercise');
		for (const item of exerciseItems) {
			lines.push(`\t- [ ] ${item}`);
		}
	}

	} // end exercise

	// Food (skip on chill weekends)
	if (!chillWeekend) {
	const foodRow = getFoodForDay(data.foodPlanLines, dayName);
	if (foodRow) {
		const parsed = parseFoodRow(foodRow);
		lines.push('- [ ] Food');
		if (parsed) {
			lines.push(`\t- [ ] Lunch: ${parsed.lunch}`);
			lines.push(`\t- [ ] Dinner: ${parsed.dinner}`);
		}
	}

	} // end food

	// Tasks: scheduled (matching today), day, sampled week, sampled month, sampled year
	const scheduledTasks = data.tasks.scheduled.filter(
		(t) => !t.done && t.scheduledDate === dateTag,
	);
	const dayTasks = chillWeekend ? [] : data.tasks.day.filter((t) => !t.done);
	const weekTasks = chillWeekend ? [] : sampleForScope(data.tasks.week, 'week', date);
	const monthTasks = chillWeekend ? [] : sampleForScope(data.tasks.month, 'month', date);
	const yearTasks = chillWeekend ? [] : sampleForScope(data.tasks.year, 'year', date);

	const allTasks = [...scheduledTasks, ...dayTasks, ...weekTasks, ...monthTasks, ...yearTasks];
	if (allTasks.length > 0) {
		lines.push('- [ ] Tasks');
		if (scheduledTasks.length > 0) {
			for (const line of formatTaskLines(scheduledTasks, 1)) lines.push(line);
		}
		if (dayTasks.length > 0) {
			for (const line of formatTaskLines(dayTasks, 1)) lines.push(line);
		}
		if (weekTasks.length > 0) {
			for (const line of formatTaskLines(weekTasks, 1)) lines.push(line);
		}
		if (monthTasks.length > 0) {
			for (const line of formatTaskLines(monthTasks, 1)) lines.push(line);
		}
		if (yearTasks.length > 0) {
			for (const line of formatTaskLines(yearTasks, 1)) lines.push(line);
		}
	}

	// Weekly review (skip on chill weekends)
	if (!chillWeekend && settings.weeklyReview && date.day() === settings.weeklyReviewDay) {
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

	// Sync previous unsynced notes before creating a new one
	const syncResult = await syncPreviousNotes(app, settings, date);
	const totalSynced =
		syncResult.completed.length +
		syncResult.rolledBack.length +
		syncResult.appended.day.length +
		syncResult.appended.week.length +
		syncResult.appended.month.length +
		syncResult.appended.year.length +
		syncResult.appended.scheduled.length;
	if (totalSynced > 0) {
		new Notice(
			`Great day: synced previous note(s) — ${syncResult.completed.length} completed, ${syncResult.rolledBack.length} rolled back, ${syncResult.appended.day.length + syncResult.appended.week.length + syncResult.appended.month.length + syncResult.appended.year.length + syncResult.appended.scheduled.length} new task(s) added.`,
		);
	}

	// Ensure folder exists
	const folderExists = app.vault.getAbstractFileByPath(folder);
	if (!folderExists) {
		await app.vault.create(folder + '/.gitkeep', '');
	}

	// Generate content (re-reads TODOs after sync)
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
