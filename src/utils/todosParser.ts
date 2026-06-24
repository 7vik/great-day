import type { Task, TaskScope, TodosData } from '../types';

/** Matches a checkbox task line: `- [ ]` or `- [x]` (case-insensitive). */
const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

/** Matches scope tags in new tasks: (D), (W), (M), (Y). */
const TAG_RE = /\(([DWdwmM])\)\s*$/;

/** Matches date tags in new tasks: (DD-MM-YYYY). */
const DATE_TAG_RE = /\((\d{2}-\d{2}-\d{4})\)\s*$/;

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
type Section = 'food' | 'exercise' | 'day' | 'week' | 'month' | 'year' | 'scheduled' | null;

/** Checks if a line is a heading we recognise for task sections. */
function matchTaskSection(trimmedLower: string): Section {
	if (trimmedLower === '# day' || trimmedLower === '## day') return 'day';
	if (trimmedLower === '# week' || trimmedLower === '## week') return 'week';
	if (trimmedLower === '# month' || trimmedLower === '## month') return 'month';
	if (trimmedLower === '# year' || trimmedLower === '## year') return 'year';
	if (trimmedLower === '# scheduled' || trimmedLower === '## scheduled') return 'scheduled';
	return null;
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

/** Parses the full TODOs.md text into structured data. */
export function parseTodos(raw: string): TodosData {
	const lines = raw.split('\n');
	const foodPlanLines: string[] = [];
	const exercisePlanLines: string[] = [];
	const tasks: Record<TaskScope, Task[]> = {
		day: [], week: [], month: [], year: [], scheduled: [],
	};

	let currentSection: Section = null;

	for (const line of lines) {
		const trimmedLower = line.trim().toLowerCase();

		if (trimmedLower.startsWith('# food plan')) {
			currentSection = 'food';
			continue;
		}

		if (trimmedLower.startsWith('# exercise plan')) {
			currentSection = 'exercise';
			continue;
		}

		const taskSection = matchTaskSection(trimmedLower);
		if (taskSection) {
			currentSection = taskSection;
			continue;
		}

		if (currentSection === 'food') {
			if (trimmedLower.startsWith('#')) {
				currentSection = null;
			} else {
				foodPlanLines.push(line);
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

		const taskMatch = line.match(TASK_RE);
		if (taskMatch && currentSection && (currentSection === 'day' || currentSection === 'week' || currentSection === 'month' || currentSection === 'year' || currentSection === 'scheduled')) {
			const indentStr = taskMatch[1] ?? '';
			const doneChar = taskMatch[2] ?? ' ';
			const text = taskMatch[3] ?? '';
			const scheduledDate = currentSection === 'scheduled' ? extractDateTag(text) : null;
			tasks[currentSection].push({
				raw: line,
				text,
				done: doneChar.toLowerCase() === 'x',
				scope: currentSection,
				indent: indentStr.length,
				scheduledDate,
			});
		}
	}

	const exercisePlanText = exercisePlanLines.join('\n').trimEnd();

	return {
		raw,
		foodPlanLines,
		exercisePlanText,
		tasks,
	};
}

/** Extracts the food row for a given day short-name (e.g. "Mon", "Tue"). */
export function getFoodForDay(foodPlanLines: string[], dayName: string): string | null {
	for (const line of foodPlanLines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('|') && trimmed.toLowerCase().includes(dayName.toLowerCase())) {
			return line;
		}
	}
	return null;
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

/** Removes the scope tag from task text. */
export function stripTag(text: string): string {
	return text.replace(TAG_RE, '').trimEnd();
}

/** Builds a task line with proper indentation (using tabs). */
function buildTaskLine(task: Task): string {
	const indent = '\t'.repeat(task.indent);
	const checkbox = task.done ? '- [x]' : '- [ ]';
	let suffix = '';
	if (task.scope === 'scheduled' && task.scheduledDate) {
		suffix = ` (${task.scheduledDate})`;
	}
	return `${indent}${checkbox} ${task.text}${suffix}`;
}

/** Serialises TodosData back into file text. */
export function serialiseTodos(data: TodosData): string {
	const sections: string[] = [];

	if (data.foodPlanLines.length > 0) {
		sections.push('# Food Plan');
		sections.push(data.foodPlanLines.join('\n').trim());
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

	for (const scope of ['day', 'week', 'month', 'year', 'scheduled'] as TaskScope[]) {
		const scopeTasks = data.tasks[scope];
		if (scopeTasks.length > 0) {
			const taskLines = scopeTasks.map((t) => buildTaskLine(t));
			sections.push(scopeHeading[scope] + '\n' + taskLines.join('\n'));
		}
	}

	return sections.join('\n\n') + '\n';
}
