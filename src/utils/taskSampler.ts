import type { Task, TaskScope } from '../types';
import { daysLeftInWeek, daysLeftInMonth, daysLeftInYear } from './dateUtils';
import { moment } from 'obsidian';

/** Fisher-Yates shuffle (returns a new array, doesn't mutate input). */
function shuffle<T>(arr: T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

/**
 * Samples tasks from a scope's task list.
 * Returns ceil(available / daysLeft) top-level tasks (min 1, max all).
 * When a parent task is picked, its nested children are included.
 * Picked tasks are shuffled randomly.
 *
 * For 'day' scope, all tasks are returned (no sampling, no shuffle).
 */
export function sampleTasks(
	tasks: Task[],
	daysLeft: number,
	shuffleResults: boolean,
): Task[] {
	const available = tasks.filter((t) => !t.done);
	if (available.length === 0) return [];

	const topLevel = available.filter((t) => t.indent === 0);
	// If no top-level tasks, treat all as top-level
	const candidates = topLevel.length > 0 ? topLevel : available;

	if (daysLeft <= 1) {
		return withChildren(
			shuffleResults ? shuffle(candidates) : candidates,
			available,
		);
	}

	const count = Math.ceil(candidates.length / daysLeft);
	const clamped = Math.max(1, Math.min(count, candidates.length));

	if (clamped >= candidates.length) {
		return withChildren(
			shuffleResults ? shuffle(candidates) : candidates,
			available,
		);
	}

	// Shuffle candidates, then pick the first `clamped` of them
	const shuffled = shuffleResults ? shuffle(candidates) : candidates;
	const picked = shuffled.slice(0, clamped);
	return withChildren(picked, available);
}

/** Given a set of picked parent tasks, include their nested children from the full list. */
function withChildren(picked: Task[], allTasks: Task[]): Task[] {
	const result: Task[] = [];
	for (const parent of picked) {
		result.push(parent);
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

/** Samples tasks for each scope based on days remaining. */
export function sampleForScope(
	tasks: Task[],
	scope: TaskScope,
	date: moment.Moment,
): Task[] {
	switch (scope) {
		case 'day':
			// All day tasks, no shuffle, no sampling
			return tasks.filter((t) => !t.done);
		case 'week':
			return sampleTasks(tasks, daysLeftInWeek(date), true);
		case 'month':
			return sampleTasks(tasks, daysLeftInMonth(date), true);
		case 'year':
			return sampleTasks(tasks, daysLeftInYear(date), true);
		default:
			return [];
	}
}
