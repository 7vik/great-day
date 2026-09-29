import type { TaskScope, TodosData } from '../types';

export interface TaskReference {
	text: string;
	scope: TaskScope;
	scheduledDate: string | null;
}

export function taskIdentity(
	text: string,
	scope: TaskScope,
	scheduledDate: string | null,
): string {
	return scheduledDate
		? `${text}\u0000date\u0000${scheduledDate}`
		: `${text}\u0000scope\u0000${scope}`;
}

/**
 * How many days back every sync re-reads, regardless of the cursor. With
 * Obsidian Sync across devices, a note can be synced on one device before the
 * edits made on another device have arrived; re-reading a trailing window picks
 * up those late edits the next time any sync runs. Re-syncing a note is
 * idempotent, so this is safe.
 */
export const RESYNC_WINDOW_DAYS = 30;

export function selectPendingDateStrings(
	candidateDates: string[],
	targetDate: string,
	lastSuccessfulSyncDate: string | null,
	/** Earliest date always included (YYYY-MM-DD), even if before the cursor. */
	windowStart: string | null = null,
): string[] {
	const lowerBound = lastSuccessfulSyncDate && windowStart
		? (lastSuccessfulSyncDate < windowStart ? lastSuccessfulSyncDate : windowStart)
		: lastSuccessfulSyncDate ?? windowStart;
	return candidateDates
		.filter((date) => date < targetDate)
		.filter((date) => !lowerBound || date >= lowerBound)
		.sort((left, right) => left.localeCompare(right));
}

export function removeCompletedTasks(
	data: TodosData,
	completedTasks: TaskReference[],
	completedDate: string,
): string[] {
	const completedKeys = new Set(
		completedTasks.map((task) =>
			taskIdentity(task.text, task.scope, task.scheduledDate)),
	);
	const removed: string[] = [];
	const archived: TodosData['completedTasks'] = [];

	for (const scope of ['day', 'week', 'month', 'year', 'scheduled'] as TaskScope[]) {
		const indicesToRemove = new Set<number>();
		for (let index = 0; index < data.tasks[scope].length; index++) {
			const task = data.tasks[scope][index]!;
			if (!completedKeys.has(taskIdentity(task.text, scope, task.scheduledDate))) continue;

			indicesToRemove.add(index);
			removed.push(task.text);
			archived.push({ ...task, done: true, completedDate });
			for (let childIndex = index + 1; childIndex < data.tasks[scope].length; childIndex++) {
				const child = data.tasks[scope][childIndex]!;
				if (child.indent <= task.indent) break;
				indicesToRemove.add(childIndex);
				archived.push({ ...child, done: true, completedDate });
			}
		}
		data.tasks[scope] = data.tasks[scope].filter(
			(_, index) => !indicesToRemove.has(index),
		);
	}
	data.completedTasks.unshift(...archived);

	return removed;
}