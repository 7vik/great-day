import type { Task, TaskScope } from '../types';
import { daysLeftInWeek, daysLeftInMonth, daysLeftInYear } from './dateUtils';
import { moment } from 'obsidian';

/**
 * Samples tasks from a scope's task list.
 * If there are `total` tasks and `daysLeft` days remaining,
 * show `ceil(total / daysLeft)` tasks (but at least 1, at most `total`).
 * If `daysLeft <= 1`, show all remaining tasks.
 */
export function sampleTasks(
	tasks: Task[],
	daysLeft: number,
): Task[] {
	const available = tasks.filter((t) => !t.done);
	if (available.length === 0) return [];

	if (daysLeft <= 1) return available;

	const count = Math.ceil(available.length / daysLeft);
	const clamped = Math.max(1, Math.min(count, available.length));

	if (clamped >= available.length) return available;

	const result: Task[] = [];
	const step = available.length / clamped;
	for (let i = 0; i < clamped; i++) {
		const idx = Math.floor(i * step);
		const task = available[idx];
		if (task) result.push(task);
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
