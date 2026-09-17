import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment, requestUrl } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import type { Task, TaskScope, TodosData } from '../types';
import {
	parseTodos,
	getExerciseForDay,
	getReminders,
	serialiseTodos,
} from './todosParser';
import { sampleForScope } from './taskSampler';
import { parseIcsForDate, type CalendarEvent } from './icsParser';
import { convertOverdueScheduled } from './rollover';
import { dayLong, formatDate } from './dateUtils';
import type GreatDayPlugin from '../main';

/** Resolves {{year}} in a folder path to the current year. */
export function resolveFolder(path: string, date: moment.Moment): string {
	return path.replace('{{year}}', String(date.year()));
}

/** Checks if a date is a weekend (Saturday or Sunday). */
function isWeekend(date: moment.Moment): boolean {
	const day = date.day();
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

/** Returns the urgency tag suffix for a task scope. */
function urgencySuffix(scope: TaskScope, scheduledDate: string | null): string {
	if (scheduledDate) {
		return ` (${scheduledDate})`;
	}
	const tagMap: Record<TaskScope, string> = {
		day: '(D)',
		week: '(W)',
		month: '(M)',
		year: '(Y)',
		scheduled: '',
	};
	return ` ${tagMap[scope]}`;
}

/** Formats a task and its children as checkbox lines with urgency tags. */
function formatTaskLines(tasks: Task[], startIndent: number): string[] {
	const lines: string[] = [];
	for (const task of tasks) {
		const indent = '\t'.repeat(startIndent + (task.indent > 0 ? 1 : 0));
		const checkbox = task.done ? '- [x]' : '- [ ]';
		const suffix = urgencySuffix(task.scope, task.scheduledDate);
		// Only top-level tasks get the urgency tag (children inherit parent's)
		const tag = task.indent === 0 ? suffix : '';
		lines.push(`${indent}${checkbox} ${task.text}${tag}`);
	}
	return lines;
}

/** Generates the daily note content. */
export async function generateDailyNoteContent(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
	/**
	 * TODOs state as just written by rollover, when a sync ran immediately before
	 * this call. Passing it avoids re-reading the file: `Vault.read` can return
	 * Obsidian's cached pre-write content, and the demote pass below rewrites the
	 * file from whatever it parsed — so a stale read here silently erases the
	 * tasks the sync had appended moments earlier.
	 */
	syncedTodos: TodosData | null = null,
): Promise<string> {
	let data: TodosData;
	if (syncedTodos) {
		data = syncedTodos;
	} else {
		const raw = await readTodosFile(app, settings);
		if (!raw) return '';
		data = parseTodos(raw);
	}
	const fullDayName = dayLong(date);
	const dateTag = date.format('DD-MM-YYYY');

	// Promote any scheduled tasks that have come due into day tasks before we
	// pick what to surface. Rollover normally does this, but it only runs when
	// there's an unsynced previous note — doing it here means a task scheduled
	// for today shows up even on a first run or after a gap in daily notes.
	convertOverdueScheduled(data, dateTag);

	const lines: string[] = [];
	const chillWeekend = settings.chillWeekends && isWeekend(date);

	// Header
	lines.push("# What a great day!");

	// Reminders (includes Exercise/Swimming as a reminder)
	if (!chillWeekend) {
		const reminders = getReminders(data.reminderLines);
		// Add Exercise/Swimming as a reminder based on day
		const exerciseText = getExerciseForDay(data.exercisePlanText, fullDayName);
		if (exerciseText) {
			reminders.push('Exercise/Swimming');
		}
		if (reminders.length > 0) {
			lines.push('- [ ] Reminders');
			for (const reminder of reminders) {
				lines.push(`\t- [ ] ${reminder}`);
			}
		}
	}

	// Calendar events
	const events = await fetchCalendarEvents(settings, date);
	if (events.length > 0) {
		lines.push('- [ ] Calendar');
		for (const line of formatEvents(events)) {
			lines.push(line);
		}
	}

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

	// Demote shown tasks: (W)→(D), (M)→(W), (Y)→(M) in TODOs, once a task has
	// been surfaced `settings.showsBeforeDemotion` times. Until that threshold
	// is reached, the task stays in its current scope with its shown-count
	// incremented, so it can keep reappearing before being pulled down.
	//
	// This runs on chill weekends too: nothing was sampled then, so the demote
	// loops no-op, but the write still persists any newly-due scheduled tasks.
	{
		const todosFile = app.vault.getAbstractFileByPath(
			normalizePath(settings.todosFilePath),
		);
		if (todosFile && todosFile instanceof TFile) {
			// Mutate the same `data` we parsed above rather than re-reading the
			// file. Rollover has already written its appended tasks into TODOs.md,
			// and a fresh read here can return Obsidian's pre-sync cached content —
			// serialising that would clobber those newly added tasks.
			const todosData = data;
			const threshold = Math.max(1, settings.showsBeforeDemotion);

			const demoteMap: Record<string, TaskScope> = {
				week: 'day',
				month: 'week',
				year: 'month',
			};

			// Tasks demoted during this pass, tracked by text so that a task moved
			// out of `year` into `month` can't be demoted a second time when the
			// `month` bucket is processed. Demotion is one scope per day, always.
			const demotedThisRun = new Set<string>();

			for (const [fromScope, toScope] of Object.entries(demoteMap) as [TaskScope, TaskScope][]) {
				const shownTaskList = fromScope === 'week' ? weekTasks : fromScope === 'month' ? monthTasks : yearTasks;
				if (shownTaskList.length === 0) continue;
				const shownTexts = new Set(shownTaskList.filter(t => t.indent === 0).map(t => t.text));

				const kept: Task[] = [];
				const demoted: Task[] = [];
				const source = todosData.tasks[fromScope];
				for (let i = 0; i < source.length; i++) {
					const t = source[i];
					if (!t) continue;
					if (t.indent === 0 && shownTexts.has(t.text) && !demotedThisRun.has(t.text)) {
						const newCount = t.shownCount + 1;
						if (newCount >= threshold) {
							// Demote this task and pull its children along with it.
							demotedThisRun.add(t.text);
							demoted.push({ ...t, scope: toScope, scheduledDate: null, shownCount: 0 });
							for (let j = i + 1; j < source.length; j++) {
								const child = source[j];
								if (!child || child.indent <= t.indent) break;
								demoted.push({ ...child, scope: toScope, scheduledDate: null, shownCount: 0 });
								i = j;
							}
						} else {
							// Not demoted yet — keep it here, just bump the shown count.
							kept.push({ ...t, shownCount: newCount });
						}
					} else {
						kept.push(t);
					}
				}
				todosData.tasks[fromScope] = kept;
				todosData.tasks[toScope].push(...demoted);
			}

			await app.vault.modify(todosFile, serialiseTodos(todosData));
		}
	}

	// Weekly review
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
	plugin: GreatDayPlugin,
	date: moment.Moment,
): Promise<TFile | null> {
	const { app, settings } = plugin;
	const dateStr = formatDate(date, settings.dateFormat);
	const folder = normalizePath(resolveFolder(settings.dailyNotesFolder, date));
	const filePath = normalizePath(`${folder}/${dateStr}.md`);
	const syncResult = await plugin.syncPendingNotes(date);

	// Check if file already exists
	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing && existing instanceof TFile) {
		new Notice('Great day: daily note already exists, opening it.');
		await app.workspace.openLinkText(filePath, '', false);
		return existing;
	}

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

	// Generate content from the state rollover just wrote, rather than re-reading
	// the file (see the `syncedTodos` parameter for why that read is unsafe).
	const content = await generateDailyNoteContent(app, settings, date, syncResult.todos);
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
