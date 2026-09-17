import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import type { TaskScope, SyncBatchResult, SyncResult, Task } from '../types';
import {
	parseTodos,
	extractNewTaskTag,
	stripTag,
	extractDateTag,
	stripDateTag,
	serialiseTodos,
	parseTaggedTask,
} from './todosParser';
import { getDailyNoteFile, resolveFolder } from './dailyNoteGenerator';
import { formatDate } from './dateUtils';
import { removeCompletedTasks, selectPendingDateStrings } from './syncState';

/** Marker written at the end of a daily note after rollover to prevent double-sync. */
const SYNCED_MARKER = '<!-- great-day-synced -->';

/** Matches a checkbox task line. */
const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

export function selectPendingNoteDates(
	filePaths: string[],
	settings: GreatDaySettings,
	targetDate: moment.Moment,
	lastSuccessfulSyncDate: string | null,
): moment.Moment[] {
	const dates = new Map<string, moment.Moment>();

	for (const filePath of filePaths) {
		const fileName = filePath.split('/').at(-1);
		if (!fileName?.endsWith('.md')) continue;
		const date = moment(fileName.slice(0, -3), settings.dateFormat, true);
		if (!date.isValid()) continue;

		const expectedPath = normalizePath(
			`${resolveFolder(settings.dailyNotesFolder, date)}/${formatDate(date, settings.dateFormat)}.md`,
		);
		if (filePath === expectedPath) dates.set(date.format('YYYY-MM-DD'), date);
	}

	return selectPendingDateStrings(
		[...dates.keys()],
		targetDate.format('YYYY-MM-DD'),
		lastSuccessfulSyncDate,
	).map((date) => dates.get(date)!);
}

/** A parsed task from the daily note (under Tasks section). */
interface ParsedTask {
	raw: string;
	done: boolean;
	text: string;
	sourceText: string;
	indent: number;
	/** Where this task came from, extracted from urgency tag. */
	originScope: TaskScope;
	/** Scheduled date if the task had a (DD-MM-YYYY) tag. */
	originDate: string | null;
}

/** Result of parsing a daily note. */
interface DailyNoteTasks {
	pulledTasks: ParsedTask[];
	newTasks: ParsedTask[];
}

/** Extracts the origin scope and date from a task's urgency tag. */
function extractOrigin(text: string): { scope: TaskScope; date: string | null; cleanText: string } {
	// Check for date tag first
	const dateTag = extractDateTag(text);
	if (dateTag) {
		return { scope: 'scheduled', date: dateTag, cleanText: stripDateTag(text) };
	}
	// Check for scope tag
	const tagResult = extractNewTaskTag(text);
	if (tagResult) {
		return { scope: tagResult.scope, date: null, cleanText: stripTag(text) };
	}
	// No tag — default to day
	return { scope: 'day', date: null, cleanText: text };
}

/** Normalises a heading for comparison: lowercased, trimmed, no trailing colon. */
function normaliseHeading(text: string): string {
	return text.trim().toLowerCase().replace(/[:\s]+$/, '');
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
	let parentOrigin: ReturnType<typeof extractOrigin> | null = null;
	let parentIndent = 0;

	for (const line of lines) {
		const trimmedLower = line.trim().toLowerCase();
		const headingMatch = trimmedLower.match(/^#+\s+(.+)$/);

		if (headingMatch) {
			// Match on the heading text alone, at any heading level, ignoring
			// surrounding whitespace and trailing punctuation. Obsidian Linter and
			// similar tools rewrite heading levels, and a stray trailing space
			// would otherwise silently stop new tasks from being collected.
			const headingText = normaliseHeading(headingMatch[1] ?? '');
			inNewTasksSection = headingText === normaliseHeading(settings.addTasksHeading);
			inTasksSection = false;
			parentOrigin = null;
			continue;
		}

		const taskMatch = line.match(TASK_RE);
		if (taskMatch) {
			const indentStr = taskMatch[1] ?? '';
			const doneChar = taskMatch[2] ?? ' ';
			const text = taskMatch[3] ?? '';
			const indent = indentStr.replace(/\t/g, '    ').length;
			let origin = extractOrigin(text);
			const hasOriginTag = extractDateTag(text) !== null || extractNewTaskTag(text) !== null;
			if (inTasksSection) {
				if (hasOriginTag) {
					parentOrigin = origin;
					parentIndent = indent;
				} else if (parentOrigin && indent > parentIndent) {
					origin = { ...parentOrigin, cleanText: text };
				}
			}

			const taskObj: ParsedTask = {
				raw: line,
				done: doneChar.toLowerCase() === 'x',
				text: origin.cleanText,
				sourceText: text,
				indent,
				originScope: origin.scope,
				originDate: origin.date,
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
		} else if (trimmedLower === '---') {
			// A horizontal rule ends the generated template block. Everything
			// below it is freeform daily writing, which may contain its own
			// headings and checkboxes that must not be treated as tasks.
			inTasksSection = false;
			inNewTasksSection = false;
			parentOrigin = null;
		} else if (inTasksSection && trimmedLower === '') {
			inTasksSection = false;
			parentOrigin = null;
		}
	}

	return { pulledTasks, newTasks };
}

/** Checks whether a daily note has already been synced. */
export function isNoteSynced(content: string): boolean {
	return content.includes(SYNCED_MARKER);
}

/**
 * Converts due scheduled tasks into day tasks.
 *
 * A scheduled task becomes a `(D)` task once its date has arrived — on the day
 * itself, not the day after. From then on it lives in `# Day` and so reappears
 * in every daily note until it's ticked off.
 *
 * `dueDateTag` is the date of the note being *generated* (i.e. today), not the
 * date of whichever older note is currently being synced — otherwise a task
 * scheduled for day N is compared against day N and never comes due.
 */
export function convertOverdueScheduled(
	data: ReturnType<typeof parseTodos>,
	dueDateTag: string,
): void {
	const due: Task[] = [];
	const remaining: Task[] = [];
	const dueBy = moment(dueDateTag, 'DD-MM-YYYY');
	for (const task of data.tasks.scheduled) {
		if (!task.done && task.scheduledDate) {
			const taskDate = moment(task.scheduledDate, 'DD-MM-YYYY');
			if (taskDate.isValid() && taskDate.isSameOrBefore(dueBy, 'day')) {
				// Avoid creating a duplicate if an identical day task already exists.
				if (!data.tasks.day.some((t) => t.text === task.text)) {
					due.push({ ...task, scope: 'day' });
				}
				continue;
			}
		}
		remaining.push(task);
	}
	data.tasks.scheduled = remaining;
	data.tasks.day.push(...due);
}

/**
 * Syncs a daily note back to TODOs:
 * - Checked pulled tasks → removed from TODOs
 * - Unchecked pulled tasks → stay in TODOs (rolled back)
 * - New tasks with tags → appended to the right TODOs section
 * - Overdue scheduled tasks → converted to day tasks
 */
export async function syncRollover(
	app: App,
	settings: GreatDaySettings,
	noteDate: moment.Moment,
	/**
	 * Date to judge scheduled tasks against — the note being generated (today).
	 * Defaults to `noteDate` for standalone calls that sync a single note.
	 */
	dueDate: moment.Moment = noteDate,
	/**
	 * TODOs state carried over from a prior sync in the same batch. When passed,
	 * it's used in place of reading the file: `Vault.read` can return Obsidian's
	 * cached pre-write content right after the previous sync's `Vault.modify`, so
	 * re-reading here would parse a snapshot missing what that sync just appended
	 * and then write it back — erasing those tasks. Threading the in-memory state
	 * removes the cache dependency. Standalone callers omit it and read the file.
	 */
	todosOverride: ReturnType<typeof parseTodos> | null = null,
): Promise<SyncResult> {
	const dailyFile = getDailyNoteFile(app, settings, noteDate);
	if (!dailyFile) {
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [], scheduled: [] }, todos: null };
	}

	const dailyContent = await app.vault.read(dailyFile);

	// Don't skip already-synced notes — they may have been synced before
	// new tasks were added (e.g. sync from another device). Reprocess always;
	// duplicate prevention (checking if task exists in TODOs) prevents double-adding.
	const parsed = parseDailyNote(dailyContent, settings);

	const todosFile = app.vault.getAbstractFileByPath(
		normalizePath(settings.todosFilePath),
	);
	if (!todosFile || !(todosFile instanceof TFile)) {
		new Notice('Great day: todos file not found for rollover sync.');
		return { rolledBack: [], completed: [], appended: { day: [], week: [], month: [], year: [], scheduled: [] }, todos: null };
	}

	const data = todosOverride ?? parseTodos(await app.vault.read(todosFile));

	// Promote scheduled tasks that have come due (relative to today) to day tasks
	convertOverdueScheduled(data, dueDate.format('DD-MM-YYYY'));

	const result: SyncResult = {
		rolledBack: [],
		completed: [],
		appended: { day: [], week: [], month: [], year: [], scheduled: [] },
		todos: null,
	};

	result.completed.push(...removeCompletedTasks(
		data,
		parsed.pulledTasks
			.filter((task) => task.done)
			.map((task) => ({
				text: task.text,
				scope: task.originScope,
				scheduledDate: task.originDate,
			})),
		noteDate.format('DD-MM-YYYY'),
	));

	// New (D) tasks are collected here and prepended to the day list as a batch
	// once all new tasks are processed, so the most recently added tasks surface
	// at the *top* of the next daily note. Collecting first (rather than
	// unshifting one at a time) preserves the order they were written in.
	const newDayTasks: Task[] = [];

	// Process new tasks
	for (const task of parsed.newTasks) {
		if (task.done) continue;
		const taggedTask = parseTaggedTask(task.sourceText);
		if (!taggedTask?.text.trim()) continue;

		if (taggedTask.scope === 'scheduled' && taggedTask.scheduledDate) {
			// Avoid duplicates
			if (!data.tasks.scheduled.some(t => t.text === taggedTask.text && t.scheduledDate === taggedTask.scheduledDate)) {
				data.tasks.scheduled.push({
					raw: `- [ ] ${taggedTask.text} (${taggedTask.scheduledDate})`,
					text: taggedTask.text,
					done: false,
					scope: 'scheduled',
					indent: 0,
					scheduledDate: taggedTask.scheduledDate,
					shownCount: 0,
				});
				result.appended.scheduled.push(taggedTask.text);
			}
			continue;
		}

		if (taggedTask.scope !== 'scheduled') {
			if (!data.tasks[taggedTask.scope].some(t => t.text === taggedTask.text)) {
				const newTask: Task = {
					raw: `- [ ] ${taggedTask.text}`,
					text: taggedTask.text,
					done: false,
					scope: taggedTask.scope,
					indent: 0,
					scheduledDate: null,
					shownCount: 0,
				};
				if (taggedTask.scope === 'day') {
					// Defer to the batch prepend below so newest lands on top.
					newDayTasks.push(newTask);
				} else {
					data.tasks[taggedTask.scope].push(newTask);
				}
				result.appended[taggedTask.scope].push(taggedTask.text);
			}
		}
	}

	// Prepend the batch of new (D) tasks so the most recently added tasks appear
	// at the top of the day list (and therefore the top of the next daily note),
	// above tasks carried over from previous days.
	if (newDayTasks.length > 0) {
		data.tasks.day.unshift(...newDayTasks);
	}

	// Write back TODOs, and hand the in-memory state to the caller. Anything that
	// keeps working with TODOs after this point must use `result.todos`: reading
	// the file back can return Obsidian's cached pre-write content, and
	// serialising that stale copy would erase the tasks just appended above.
	const newTodos = serialiseTodos(data);
	await app.vault.modify(todosFile, newTodos);
	result.todos = data;

	// Mark the daily note as synced. Strip *every* existing marker, not just the
	// first: a string argument to `replace` only swaps one occurrence, so repeat
	// syncs used to leave stale markers stranded mid-note (sometimes inside the
	// new-tasks section, splitting it in two).
	let updatedContent = dailyContent.split(SYNCED_MARKER).join('').trimEnd();
	updatedContent += '\n\n' + SYNCED_MARKER + '\n';
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
 */
export async function syncPreviousNotes(
	app: App,
	settings: GreatDaySettings,
	targetDate: moment.Moment,
	lastSuccessfulSyncDate: string | null = null,
): Promise<SyncBatchResult> {
	const combined: SyncBatchResult = {
		rolledBack: [],
		completed: [],
		appended: { day: [], week: [], month: [], year: [], scheduled: [] },
		todos: null,
		canAdvanceCursor: true,
	};

	// Discover actual daily-note files after the persisted cursor instead of
	// imposing a fixed lookback. This handles arbitrarily long gaps without
	// scanning dates for notes that do not exist.
	//
	// Sync oldest -> newest and thread the in-memory TODOs state from one sync
	// into the next. Two reasons:
	//   1. Reading the file at the start of each sync can return Obsidian's cached
	//      pre-write copy from the previous sync's write, so a re-read would parse
	//      a snapshot missing what was just appended and then overwrite it.
	//   2. `combined.todos` (handed to note generation, which rewrites TODOs from
	//      it) must be the *final* state after every note is processed. Ending on
	//      the newest note makes the last write the most complete one.
	let carried: ReturnType<typeof parseTodos> | null = null;
	const noteDates = selectPendingNoteDates(
		app.vault.getMarkdownFiles().map((file) => file.path),
		settings,
		targetDate,
		lastSuccessfulSyncDate,
	);
	for (const checkDate of noteDates) {
		const result = await syncRollover(app, settings, checkDate, targetDate, carried);
		if (!result.todos) combined.canAdvanceCursor = false;
		combined.rolledBack.push(...result.rolledBack);
		combined.completed.push(...result.completed);
		combined.appended.day.push(...result.appended.day);
		combined.appended.week.push(...result.appended.week);
		combined.appended.month.push(...result.appended.month);
		combined.appended.year.push(...result.appended.year);
		combined.appended.scheduled.push(...result.appended.scheduled);
		if (result.todos) {
			carried = result.todos;
			combined.todos = result.todos;
		}
	}

	return combined;
}
