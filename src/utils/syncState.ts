import type { Task, TaskScope, TodosData } from '../types';

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
/**
 * Collapses duplicate top-level tasks across the active scopes, keeping the
 * first copy in urgency order (day → week → month → year) and moving any
 * children the duplicate had that the kept copy lacks.
 *
 * Two devices can each append the same new task before either has received
 * the other's TODOs.md; Obsidian Sync then merges both inserts and the task
 * appears twice. The append-time check can't prevent that, so every sync
 * repairs it instead. Returns the texts of the removed duplicates.
 */
// Same rule as `normaliseTaskText` in todosParser; duplicated so this module
// stays import-free for the node test runner.
const normaliseTaskText = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function dedupeTasks(data: TodosData): string[] {
	const kept = new Map<string, Task[]>();
	const removed: string[] = [];
	const done: TaskScope[] = [];

	for (const scope of ['day', 'week', 'month', 'year'] as TaskScope[]) {
		const result: Task[] = [];
		const source = data.tasks[scope];
		for (let index = 0; index < source.length; index++) {
			const task = source[index]!;
			if (task.indent !== 0) {
				result.push(task);
				continue;
			}
			const children: Task[] = [];
			while (index + 1 < source.length && source[index + 1]!.indent > 0) {
				children.push(source[++index]!);
			}
			const key = normaliseTaskText(task.text);
			const original = kept.get(key);
			if (!original) {
				const group = [task, ...children];
				kept.set(key, group);
				result.push(...group);
				continue;
			}
			removed.push(task.text);
			const known = new Set(original.map((t) => normaliseTaskText(t.text)));
			const extra = children.filter((child) => !known.has(normaliseTaskText(child.text)));
			if (extra.length > 0) {
				// Insert after the kept copy's last child, wherever it lives.
				// Only search lists already rebuilt — `source` is still being walked.
				for (const list of [result, ...done.map((s) => data.tasks[s])]) {
					const at = list.indexOf(original.at(-1)!);
					if (at >= 0) {
						list.splice(at + 1, 0, ...extra);
						break;
					}
				}
				original.push(...extra);
			}
		}
		data.tasks[scope] = result;
		done.push(scope);
	}

	return removed;
}
