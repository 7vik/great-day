/** Identifies which TODOs section a task belongs to. */
export type TaskScope = 'day' | 'week' | 'month' | 'year' | 'scheduled';

/** A single task line from TODOs.md. */
export interface Task {
	/** The raw text of the task, including checkbox `- [ ]` or `- [x]`. */
	raw: string;
	/** The task text without the checkbox prefix. */
	text: string;
	/** Whether the task is checked off. */
	done: boolean;
	/** Which section the task came from. */
	scope: TaskScope;
	/** Indentation level (0 = top-level, 1 = one tab in). */
	indent: number;
	/** For scheduled tasks: the target date as DD-MM-YYYY (null for other scopes). */
	scheduledDate: string | null;
}

/** Parsed contents of TODOs.md. */
export interface TodosData {
	/** Raw file text. */
	raw: string;
	/** Lines that make up the food plan table. */
	foodPlanLines: string[];
	/** Raw text of the exercise plan section. */
	exercisePlanText: string;
	/** Lines from the Reminders section (plain `- item` lines, no checkboxes). */
	reminderLines: string[];
	/** Tasks grouped by scope. */
	tasks: Record<TaskScope, Task[]>;
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
	/** Tasks removed from TODOs (were checked in daily note). */
	completed: string[];
	/** New tasks appended to TODOs (had scope tags). */
	appended: Record<TaskScope, string[]>;
}
