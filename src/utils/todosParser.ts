import type { CompletedTask, Task, TaskScope, TodosData } from '../types';

/** Matches a checkbox task line: `- [ ]` or `- [x]` (case-insensitive). */
const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

/** Matches scope tags in task text: (D), (W), (M), (Y). */
const TAG_RE = /\(([DWMYdwmy])\)\s*$/;

/** Matches date tags in task text: (DD-MM-YYYY). */
const DATE_TAG_RE = /\((\d{2}-\d{2}-\d{4})\)\s*$/;

/** Matches completion metadata in archived tasks. */
const COMPLETED_DATE_RE = /\(completed (\d{2}-\d{2}-\d{4})\)\s*$/i;

/**
 * Matches the hidden "shown count" marker appended to week/month/year tasks,
 * e.g. `<!--shown:2-->`. Written as an HTML comment so it doesn't clutter the
 * rendered note in Obsidian's reading view.
 */
const SHOWN_COUNT_RE = /<!--shown:(\d+)-->\s*$/;

/** Maps a tag character to a scope. */
function tagToScope(ch: string): TaskScope | null {
	switch (ch.toUpperCase()) {
		case 'D': return 'day';
		case 'W': return 'week';
		case 'M': return 'month';
		case 'Y': return 'year';
		default: return null;
	}
}

/** Tracks which section we're currently parsing. */
type Section = 'reminders' | 'exercise' | 'day' | 'week' | 'month' | 'year' | 'scheduled' | 'completed' | null;

/** Checks if a line is a heading we recognise for task sections. */
function matchTaskSection(trimmedLower: string): Section {
	if (trimmedLower === '# day' || trimmedLower === '## day') return 'day';
	if (trimmedLower === '# week' || trimmedLower === '## week') return 'week';
	if (trimmedLower === '# month' || trimmedLower === '## month') return 'month';
	if (trimmedLower === '# year' || trimmedLower === '## year') return 'year';
	if (trimmedLower === '# scheduled' || trimmedLower === '## scheduled') return 'scheduled';
	if (trimmedLower === '# completed' || trimmedLower === '## completed') return 'completed';
	return null;
}

function extractCompletedDate(text: string): string | null {
	return text.match(COMPLETED_DATE_RE)?.[1] ?? null;
}

function stripCompletedDate(text: string): string {
	return text.replace(COMPLETED_DATE_RE, '').trimEnd();
}

/** Extracts a date tag (DD-MM-YYYY) from task text, if present. */
export function extractDateTag(text: string): string | null {
	const match = text.match(DATE_TAG_RE);
	return match?.[1] ?? null;
}

/** Removes the date tag from task text. */
export function stripDateTag(text: string): string {
	return text.replace(DATE_TAG_RE, '').trimEnd();
}

/** Extracts the hidden shown-count marker from task text, if present. Defaults to 0. */
export function extractShownCount(text: string): number {
	const match = text.match(SHOWN_COUNT_RE);
	if (!match?.[1]) return 0;
	const n = parseInt(match[1], 10);
	return Number.isNaN(n) ? 0 : n;
}

/** Removes the hidden shown-count marker from task text. */
export function stripShownCount(text: string): string {
	return text.replace(SHOWN_COUNT_RE, '').trimEnd();
}

/** Extracts a scope tag (D)/(W)/(M)/(Y) from task text, if present. */
export function extractScopeTag(text: string): string | null {
	const match = text.match(TAG_RE);
	return match?.[0] ?? null;
}

/** Removes the scope tag from task text. */
export function stripScopeTag(text: string): string {
	return text.replace(TAG_RE, '').trimEnd();
}

/** Parses the full TODOs.md text into structured data. */
export function parseTodos(raw: string): TodosData {
	const lines = raw.split('\n');
	const exercisePlanLines: string[] = [];
	const reminderLines: string[] = [];
	const tasks: Record<TaskScope, Task[]> = {
		day: [], week: [], month: [], year: [], scheduled: [],
	};
	const completedTasks: CompletedTask[] = [];

	let currentSection: Section = null;
	let completedParent: Pick<CompletedTask, 'scope' | 'scheduledDate' | 'completedDate'> | null = null;

	for (const line of lines) {
		const trimmedLower = line.trim().toLowerCase();
		// Strip leading heading markers (# or ##) so section headers are recognised
		// regardless of heading level (some tools, e.g. Obsidian Linter, may rewrite
		// heading levels in the file).
		const isHeading = /^#{1,2}\s/.test(trimmedLower);
		const headingBody = isHeading ? trimmedLower.replace(/^#{1,2}\s+/, '') : '';

		// Skip food plan section entirely
		if (isHeading && headingBody.startsWith('food plan')) {
			currentSection = null;
			continue;
		}

		if (isHeading && headingBody.startsWith('reminders')) {
			currentSection = 'reminders';
			continue;
		}

		if (isHeading && headingBody.startsWith('exercise plan')) {
			currentSection = 'exercise';
			continue;
		}

		const taskSection = matchTaskSection(trimmedLower);
		if (taskSection) {
			currentSection = taskSection;
			continue;
		}

		if (currentSection === 'reminders') {
			if (trimmedLower.startsWith('#')) {
				currentSection = null;
			} else {
				reminderLines.push(line);
				continue;
			}
		}

		if (currentSection === 'exercise') {
			if (trimmedLower.startsWith('#')) {
				currentSection = null;
			} else {
				exercisePlanLines.push(line);
				continue;
			}
		}

		// Parse task lines in task sections
		const taskMatch = line.match(TASK_RE);
		if (taskMatch && currentSection === 'completed') {
			const indentStr = taskMatch[1] ?? '';
			const rawText = taskMatch[3] ?? '';
			const completedDate = extractCompletedDate(rawText) ?? completedParent?.completedDate;
			let cleanText = stripCompletedDate(rawText);
			const scheduledDate = extractDateTag(cleanText) ?? completedParent?.scheduledDate ?? null;
			const scopeTag = extractNewTaskTag(cleanText);
			const scope = scheduledDate ? 'scheduled' : scopeTag?.scope ?? completedParent?.scope ?? 'day';
			cleanText = scheduledDate ? stripDateTag(cleanText) : stripScopeTag(cleanText);
			const completedTask: CompletedTask = {
				raw: line,
				text: cleanText,
				done: true,
				scope,
				indent: indentStr.length,
				scheduledDate,
				shownCount: 0,
				completedDate: completedDate ?? '',
			};
			completedTasks.push(completedTask);
			if (completedTask.indent === 0) completedParent = completedTask;
		} else if (taskMatch && currentSection && (currentSection === 'day' || currentSection === 'week' || currentSection === 'month' || currentSection === 'year' || currentSection === 'scheduled')) {
			const indentStr = taskMatch[1] ?? '';
			const doneChar = taskMatch[2] ?? ' ';
			const rawText = taskMatch[3] ?? '';
			// Strip any trailing scope or date tags from text (so they're not doubled)
			let cleanText = stripScopeTag(rawText);
			const shownCount = extractShownCount(cleanText);
			cleanText = stripShownCount(cleanText);
			const scheduledDate = extractDateTag(cleanText);
			cleanText = scheduledDate ? stripDateTag(cleanText) : cleanText;
			tasks[currentSection].push({
				raw: line,
				text: cleanText,
				done: doneChar.toLowerCase() === 'x',
				scope: currentSection,
				indent: indentStr.length,
				scheduledDate,
				shownCount,
			});
		}
	}

	const exercisePlanText = exercisePlanLines
		.filter((line, idx, arr) => {
			const trimmed = line.trim();
			if (trimmed === '' && idx > 0 && arr[idx - 1]?.trim() === '') return false;
			return true;
		})
		.join('\n')
		.trim();

	return {
		raw,
		exercisePlanText,
		reminderLines,
		tasks,
		completedTasks,
	};
}

/** Extracts the exercise text for a given full day name (e.g. "Monday", "Saturday"). */
export function getExerciseForDay(exerciseText: string, dayName: string): string {
	const lines = exerciseText.split('\n');
	const dayLower = dayName.toLowerCase();

	if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(dayLower)) {
		return extractBlock(lines, 'monday to friday');
	}
	if (dayLower === 'saturday') {
		return extractBlock(lines, 'saturday');
	}
	if (dayLower === 'sunday') {
		return extractBlock(lines, 'sunday');
	}
	return '';
}

/** Extracts a named block and its sub-items from exercise plan lines. */
function extractBlock(lines: string[], headingFragment: string): string {
	const result: string[] = [];
	let capturing = false;

	for (const line of lines) {
		const trimmedLower = line.trim().toLowerCase();
		if (trimmedLower.includes(headingFragment)) {
			capturing = true;
			result.push(line);
			continue;
		}
		if (capturing) {
			if (trimmedLower === '') {
				result.push(line);
				continue;
			}
			if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(trimmedLower) && trimmedLower.includes(':')) {
				break;
			}
			result.push(line);
		}
	}
	return result.join('\n').trim();
}

/** Extracts reminder items (plain `- text` lines, stripping the dash). */
export function getReminders(reminderLines: string[]): string[] {
	const reminders: string[] = [];
	for (const line of reminderLines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const text = trimmed.replace(/^-\s*/, '');
		if (text) reminders.push(text);
	}
	return reminders;
}

/** Extracts new-task tags from a task line. Returns the tag and scope, or null. */
export function extractNewTaskTag(text: string): { tag: string; scope: TaskScope } | null {
	const match = text.match(TAG_RE);
	if (!match) return null;
	const ch = match[1];
	if (!ch) return null;
	const scope = tagToScope(ch);
	if (!scope) return null;
	return { tag: match[0], scope };
}

/** Parses a date or scope suffix from a newly entered task. */
export function parseTaggedTask(text: string): {
	text: string;
	scope: TaskScope;
	scheduledDate: string | null;
} | null {
	const scheduledDate = extractDateTag(text);
	if (scheduledDate) {
		return {
			text: stripDateTag(text),
			scope: 'scheduled',
			scheduledDate,
		};
	}

	const tag = extractNewTaskTag(text);
	if (!tag) return null;
	return {
		text: stripTag(text),
		scope: tag.scope,
		scheduledDate: null,
	};
}

/** Removes the scope tag from task text. */
export function stripTag(text: string): string {
	return text.replace(TAG_RE, '').trimEnd();
}

/** Builds a task line with proper indentation (using tabs). */
function buildTaskLine(task: Task): string {
	const indent = '\t'.repeat(task.indent);
	const checkbox = task.done ? '- [x]' : '- [ ]';
	let suffix = '';
	if (task.scheduledDate) {
		suffix = ` (${task.scheduledDate})`;
	}
	const shownMarker = task.shownCount > 0 ? ` <!--shown:${task.shownCount}-->` : '';
	return `${indent}${checkbox} ${sanitiseTaskText(task.text)}${suffix}${shownMarker}`;
}

function buildCompletedTaskLine(task: CompletedTask): string {
	const indent = '\t'.repeat(task.indent);
	let origin = '';
	if (task.indent === 0) {
		origin = task.scheduledDate
			? ` (${task.scheduledDate})`
			: ` (${task.scope.charAt(0).toUpperCase()})`;
	}
	const completed = task.indent === 0 && task.completedDate
		? ` (completed ${task.completedDate})`
		: '';
	return `${indent}- [x] ${sanitiseTaskText(task.text)}${origin}${completed}`;
}

/**
 * Flattens anything in a task's text that would break the one-task-per-line
 * invariant. Embedded newlines (or a checkbox marker smuggled into the middle of
 * the text) would otherwise serialise as two fused tasks on a single line, which
 * the next parse reads back as one task with the second one's text glued on.
 */
function sanitiseTaskText(text: string): string {
	return text
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s*-\s\[[ xX]\]\s*/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** Serialises TodosData back into file text. */
export function serialiseTodos(data: TodosData): string {
	const sections: string[] = [];

	if (data.reminderLines.length > 0) {
		sections.push('# Reminders');
		sections.push(data.reminderLines.join('\n').trim());
	}

	if (data.exercisePlanText) {
		sections.push('# Exercise Plan');
		sections.push(data.exercisePlanText);
	}

	const scopeHeading: Record<TaskScope, string> = {
		day: '# Day',
		week: '# Week',
		month: '# Month',
		year: '# Year',
		scheduled: '# Scheduled',
	};

	// Always emit every scope heading, even when the list is empty. Dropping an
	// empty section would delete the heading from the file, and a missing
	// `# Scheduled` leaves date-tagged tasks with nowhere to land on the next
	// parse — silently breaking date tags once the section drains.
	for (const scope of ['day', 'week', 'month', 'year', 'scheduled'] as TaskScope[]) {
		const scopeTasks = data.tasks[scope];
		const taskLines = scopeTasks.map((t) => buildTaskLine(t));
		sections.push(
			taskLines.length > 0
				? scopeHeading[scope] + '\n' + taskLines.join('\n')
				: scopeHeading[scope],
		);
	}

	const completedLines = data.completedTasks.map((task) => buildCompletedTaskLine(task));
	sections.push(
		completedLines.length > 0
			? '# Completed\n' + completedLines.join('\n')
			: '# Completed',
	);

	return sections.join('\n\n') + '\n';
}
