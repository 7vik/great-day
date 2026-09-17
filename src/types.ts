/** Identifies which TODOs section a task belongs to. */
export type TaskScope = 'day' | 'week' | 'month' | 'year' | 'scheduled';

/** A single task line from TODOs.md. */
export interface Task {
	/** The raw text of the task, including checkbox `- [ ]` or `- [x]`. */
	raw: string;
	/** The task text without the checkbox prefix or scope/date tags. */
	text: string;
	/** Whether the task is checked off. */
	done: boolean;
	/** Which section the task came from. */
	scope: TaskScope;
	/** Indentation level (0 = top-level, 1 = one tab in). */
	indent: number;
	/** For scheduled tasks: the target date as DD-MM-YYYY (null for other scopes). */
	scheduledDate: string | null;
	/**
	 * How many times this task has already been surfaced in a daily note
	 * since it last moved into its current scope. Used together with
	 * `showsBeforeDemotion` to decide when a week/month/year task gets
	 * pulled down a scope (e.g. week -> day). Always 0 for day/scheduled tasks.
	 */
	shownCount: number;
}

export interface CompletedTask extends Task {
	/** Date the task was completed, formatted as DD-MM-YYYY. */
	completedDate: string;
}

/** Parsed contents of TODOs.md. */
export interface TodosData {
	/** Raw file text. */
	raw: string;
	/** Lines from the Reminders section (plain `- item` lines, no checkboxes). */
	reminderLines: string[];
	/** Raw text of the exercise plan section. */
	exercisePlanText: string;
	/** Tasks grouped by scope. */
	tasks: Record<TaskScope, Task[]>;
	/** Completed tasks retained for reference, newest first. */
	completedTasks: CompletedTask[];
}

/** Metadata for a task added in a daily note (marked with (D), (M), (Y), (W)). */
export interface NewTaskTag {
	/** The raw suffix tag, e.g. "(D)". */
	tag: string;
	/** The scope this tag maps to. */
	scope: TaskScope;
}

/** Result of syncing a daily note back to TODOs at midnight. */
export interface SyncResult {
	/** Tasks moved back to TODOs (were unchecked in daily note). */
	rolledBack: string[];
	/** Tasks moved to the Completed archive (were checked in a daily note). */
	completed: string[];
	/** New tasks appended to TODOs (had scope tags). */
	appended: Record<TaskScope, string[]>;
	/**
	 * The TODOs state as written by the sync, or null if nothing was synced.
	 *
	 * Callers that need to keep working with TODOs *must* use this rather than
	 * re-reading the file: `Vault.read` can still return Obsidian's cached
	 * pre-write content immediately after `Vault.modify`, and serialising that
	 * stale copy silently erases whatever the sync just appended.
	 */
	todos: TodosData | null;
}

export interface SyncBatchResult extends SyncResult {
	/** Whether every discovered note was synced and the persisted cursor may advance. */
	canAdvanceCursor: boolean;
}
