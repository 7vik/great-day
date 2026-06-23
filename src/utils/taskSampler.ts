import type { Task, TaskScope } from '../types';
import { daysLeftInWeek, daysLeftInMonth, daysLeftInYear } from './dateUtils';
import { moment } from 'obsidian';

/**
 * Samples tasks from a scope's task list.
 * If there are `total` tasks and `daysLeft` days remaining,
 * show `ceil(total / daysLeft)` tasks (but at least 1, at most `total`).
 * If `daysLeft <= 1`, show all remaining tasks.
 *
 * When a parent task is sampled, its nested children are included.
 */
export function sampleTasks(
	tasks: Task[],
	daysLeft: number,
): Task[] {
	const available = tasks.filter((t) => !t.done);
	if (available.length === 0) return [];

	if (daysLeft <= 1) return withChildren(available, tasks);

	const count = Math.ceil(available.length / daysLeft);
	const clamped = Math.max(1, Math.min(count, available.length));

	// Pick top-level tasks (indent 0) for sampling, then include their children
	const topLevel = available.filter((t) => t.indent === 0);
	if (topLevel.length === 0) return withChildren(available, tasks);

	if (clamped >= topLevel.length) return withChildren(topLevel, tasks);

	const picked: Task[] = [];
	const step = topLevel.length / clamped;
	for (let i = 0; i < clamped; i++) {
		const idx = Math.floor(i * step);
		const task = topLevel[idx];
		if (task) picked.push(task);
	}
	return withChildren(picked, tasks);
}

/** Given a set of picked parent tasks, include their nested children from the full list. */
function withChildren(picked: Task[], allTasks: Task[]): Task[] {
	const result: Task[] = [];
	for (const parent of picked) {
		result.push(parent);
		// Find children that follow this task in the full list
		const parentIdx = allTasks.indexOf(parent);
		for (let i = parentIdx + 1; i < allTasks.length; i++) {
			const child = allTasks[i];
			if (!child) break;
			if (child.indent > parent.indent) {
				result.push(child);
			} else {
				break;
			}
		}
	}
	return result;
}

/** Samples tasks for each scope based on the configured count and days remaining. */
export function sampleForScope(
	tasks: Task[],
	scope: TaskScope,
	date: moment.Moment,
): Task[] {
	let daysLeft: number;
	switch (scope) {
		case 'week': daysLeft = daysLeftInWeek(date); break;
		case 'month': daysLeft = daysLeftInMonth(date); break;
		case 'year': daysLeft = daysLeftInYear(date); break;
		default: daysLeft = 1; break;
	}
	return sampleTasks(tasks, daysLeft);
}
