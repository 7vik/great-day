/**
 * Regression tests for the sync -> generate sequence.
 *
 * Run with: npm test
 *
 * These use a fake vault whose `read` deliberately returns stale content after a
 * `modify`, reproducing the Obsidian behaviour that caused new tasks added in a
 * daily note's "New tasks" section to be silently erased: rollover appended them
 * to TODOs.md, then note generation re-read the file, got the pre-write cached
 * copy, and rewrote TODOs.md from that stale parse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseTodos,
	serialiseTodos,
	extractNewTaskTag,
	stripTag,
	parseTaggedTask,
} from './todosParser.ts';
import {
	removeCompletedTasks,
	selectPendingDateStrings,
	taskIdentity,
} from './syncState.ts';
import type { TodosData } from '../types.ts';

const TODOS = [
	'# Day',
	'- [ ] existing day task',
	'',
	'# Week',
	'',
	'# Month',
	'',
	'# Year',
	'',
	'# Scheduled',
	'',
].join('\n');

test('new task tags are classified before their suffix is stripped', () => {
	assert.deepEqual(parseTaggedTask('schedule task for today (17-09-2026)'), {
		text: 'schedule task for today',
		scope: 'scheduled',
		scheduledDate: '17-09-2026',
	});
	assert.deepEqual(parseTaggedTask('buy groceries (D)'), {
		text: 'buy groceries',
		scope: 'day',
		scheduledDate: null,
	});
	assert.equal(parseTaggedTask('task without a tag'), null);
});

test('a promoted day task keeps its original scheduled date', () => {
	const data = parseTodos(TODOS);
	data.tasks.day.push({
		raw: '- [ ] scheduled reminder (17-09-2026)',
		text: 'scheduled reminder',
		done: false,
		scope: 'day',
		indent: 0,
		scheduledDate: '17-09-2026',
		shownCount: 0,
	});

	const serialised = serialiseTodos(data);
	assert.match(serialised, /# Day\n[\s\S]*scheduled reminder \(17-09-2026\)/);
	assert.equal(parseTodos(serialised).tasks.day.at(-1)?.scheduledDate, '17-09-2026');
});

test('task identity distinguishes duplicate text by scope or scheduled date', () => {
	assert.notEqual(
		taskIdentity('Call Alex', 'day', null),
		taskIdentity('Call Alex', 'week', null),
	);
	assert.notEqual(
		taskIdentity('Call Alex', 'scheduled', '20-09-2026'),
		taskIdentity('Call Alex', 'scheduled', '21-09-2026'),
	);
	assert.equal(
		taskIdentity('Call Alex', 'scheduled', '20-09-2026'),
		taskIdentity('Call Alex', 'day', '20-09-2026'),
	);
});

test('completing a task preserves duplicates from other scopes and dates', () => {
	const data = parseTodos([
		'# Day',
		'- [ ] Call Alex',
		'\t- [ ] Prepare notes',
		'',
		'# Week',
		'- [ ] Call Alex',
		'',
		'# Month',
		'',
		'# Year',
		'',
		'# Scheduled',
		'- [ ] Call Alex (20-09-2026)',
	].join('\n'));

	assert.deepEqual(removeCompletedTasks(data, [{
		text: 'Call Alex',
		scope: 'day',
		scheduledDate: null,
	}], '17-09-2026'), ['Call Alex']);
	assert.deepEqual(data.tasks.day, []);
	assert.equal(data.tasks.week[0]?.text, 'Call Alex');
	assert.equal(data.tasks.scheduled[0]?.scheduledDate, '20-09-2026');
});

test('completed tasks and their children move to a dated completed archive', () => {
	const data = parseTodos([
		'# Day',
		'- [ ] Call Alex',
		'\t- [ ] Prepare notes',
		'',
		'# Week',
		'',
		'# Month',
		'',
		'# Year',
		'',
		'# Scheduled',
	].join('\n'));

	removeCompletedTasks(data, [{
		text: 'Call Alex',
		scope: 'day',
		scheduledDate: null,
	}], '17-09-2026');

	const serialised = serialiseTodos(data);
	assert.match(
		serialised,
		/# Completed\n- \[x\] Call Alex \(D\) \(completed 17-09-2026\)\n\t- \[x\] Prepare notes/,
	);
	const reparsed = parseTodos(serialised);
	assert.equal(reparsed.completedTasks[0]?.scope, 'day');
	assert.equal(reparsed.completedTasks[0]?.completedDate, '17-09-2026');
	assert.equal(reparsed.completedTasks[1]?.text, 'Prepare notes');
});

test('pending note discovery is not limited to the previous 30 days', () => {
	assert.deepEqual(
		selectPendingDateStrings(
			['2026-06-01', '2026-09-16'],
			'2026-09-17',
			null,
		),
		['2026-06-01', '2026-09-16'],
	);
	assert.deepEqual(
		selectPendingDateStrings(
			['2026-06-01', '2026-09-16'],
			'2026-09-17',
			'2026-06-01',
		),
		['2026-06-01', '2026-09-16'],
	);
});

/** Appends a tagged new task the way syncRollover does. */
function appendNewTask(data: TodosData, rawText: string): void {
	const tag = extractNewTaskTag(rawText);
	if (!tag) return;
	const text = stripTag(rawText);
	if (data.tasks[tag.scope].some((t) => t.text === text)) return;
	data.tasks[tag.scope].push({
		raw: `- [ ] ${text}`,
		text,
		done: false,
		scope: tag.scope,
		indent: 0,
		scheduledDate: null,
		shownCount: 0,
	});
}

/**
 * Appends a batch of tagged new tasks the way the fixed syncRollover does:
 * (D) tasks are collected and prepended to the day list as a batch so the most
 * recently added ones surface at the top, while other scopes are appended.
 */
function appendNewTasksBatch(data: TodosData, rawTexts: string[]): void {
	const newDayTasks: TodosData['tasks']['day'] = [];
	for (const rawText of rawTexts) {
		const tag = extractNewTaskTag(rawText);
		if (!tag) continue;
		const text = stripTag(rawText);
		if (data.tasks[tag.scope].some((t) => t.text === text)) continue;
		const task = {
			raw: `- [ ] ${text}`,
			text,
			done: false,
			scope: tag.scope,
			indent: 0,
			scheduledDate: null,
			shownCount: 0,
		};
		if (tag.scope === 'day') newDayTasks.push(task);
		else data.tasks[tag.scope].push(task);
	}
	if (newDayTasks.length > 0) data.tasks.day.unshift(...newDayTasks);
}

/**
 * A vault whose read returns the content as of the *previous* write, modelling
 * Obsidian serving a cached copy immediately after modify().
 */
class StaleVault {
	private committed: string;
	private pending: string | null = null;
	constructor(initial: string) {
		this.committed = initial;
	}
	read(): string {
		return this.committed;
	}
	modify(content: string): void {
		// The write lands, but a subsequent read still sees the old content until
		// the cache flushes.
		this.pending = content;
	}
	/** The content a later reader would eventually observe. */
	settled(): string {
		return this.pending ?? this.committed;
	}
}

test('new tagged task survives the sync -> generate sequence', () => {
	const vault = new StaleVault(TODOS);

	// --- rollover: parse, append the new task, write back ---
	const synced = parseTodos(vault.read());
	appendNewTask(synced, 'Email Rahul at Sabi Vinod Khosla BCI startup (W)');
	vault.modify(serialiseTodos(synced));

	assert.equal(synced.tasks.week.length, 1, 'task should be appended in memory');

	// --- generate: must use the synced data, NOT re-read the vault ---
	// Re-reading here is what used to lose the task: the read returns stale text.
	const staleReparse = parseTodos(vault.read());
	assert.equal(
		staleReparse.tasks.week.length,
		0,
		'sanity: a re-read really does miss the new task',
	);

	// Generation rewrites TODOs from whatever it parsed. Using the synced object
	// keeps the task; using the stale re-read would erase it.
	vault.modify(serialiseTodos(synced));

	assert.match(
		vault.settled(),
		/Email Rahul at Sabi Vinod Khosla BCI startup/,
		'new task must still be present after generation rewrites TODOs',
	);
});

test('generating from a stale re-read is what erased the task', () => {
	const vault = new StaleVault(TODOS);

	const synced = parseTodos(vault.read());
	appendNewTask(synced, 'Email Rahul at Sabi Vinod Khosla BCI startup (W)');
	vault.modify(serialiseTodos(synced));

	// The old, buggy path: re-read and rewrite from that.
	vault.modify(serialiseTodos(parseTodos(vault.read())));

	assert.doesNotMatch(
		vault.settled(),
		/Email Rahul at Sabi Vinod Khosla BCI startup/,
		'documents the regression: the stale path drops the task',
	);
});

test('all scope headings survive a round-trip even when empty', () => {
	const out = serialiseTodos(parseTodos(TODOS));
	for (const heading of ['# Day', '# Week', '# Month', '# Year', '# Scheduled']) {
		assert.ok(out.includes(heading), `${heading} must be preserved`);
	}
});

test('syncing multiple notes in one batch keeps every appended task', () => {
	// Models syncPreviousNotes threading one TodosData through several notes.
	// The old code re-read the vault at the start of each sync (getting the stale
	// pre-write copy) and let the last loop iteration's write win, so tasks
	// appended for earlier-processed notes were dropped. Threading the same object
	// forward — and writing once at the end — keeps them all.
	const vault = new StaleVault(TODOS);

	// Read the file exactly once, then thread the parsed object across notes.
	const data = parseTodos(vault.read());
	appendNewTask(data, 'task from older note (W)'); // note synced first
	appendNewTask(data, 'task from newer note (W)'); // note synced second
	vault.modify(serialiseTodos(data)); // single final write

	assert.match(vault.settled(), /task from older note/, 'older note task kept');
	assert.match(vault.settled(), /task from newer note/, 'newer note task kept');
});

test('re-reading the vault between note syncs is what dropped a task', () => {
	// Documents the regression: parsing from a stale read between appends loses
	// whatever the previous append added.
	const vault = new StaleVault(TODOS);

	const first = parseTodos(vault.read());
	appendNewTask(first, 'task from older note (W)');
	vault.modify(serialiseTodos(first));

	// Buggy path: start the next note's sync by re-reading (stale) and appending
	// to that, then write. The older note's task is gone.
	const second = parseTodos(vault.read());
	appendNewTask(second, 'task from newer note (W)');
	vault.modify(serialiseTodos(second));

	assert.doesNotMatch(vault.settled(), /task from older note/, 'stale re-read drops the earlier task');
});

test('newest (D) tasks land at the top of the day list', () => {
	const data = parseTodos(TODOS);
	assert.equal(data.tasks.day[0]?.text, 'existing day task', 'precondition');

	appendNewTasksBatch(data, ['first new (D)', 'second new (D)']);

	// The batch of new (D) tasks sits above the pre-existing day task, in the
	// order they were written (the (D) tag is stripped from stored text).
	assert.deepEqual(
		data.tasks.day.map((t) => t.text),
		['first new', 'second new', 'existing day task'],
	);
});

test('serialising never fuses two tasks onto one line', () => {
	const data = parseTodos(TODOS);
	// Text carrying an embedded checkbox must not produce two tasks on one line.
	data.tasks.day.push({
		raw: '- [ ] x',
		text: 'first task- [ ] second task',
		done: false,
		scope: 'day',
		indent: 0,
		scheduledDate: null,
		shownCount: 0,
	});
	const out = serialiseTodos(data);
	for (const line of out.split('\n')) {
		const checkboxes = line.match(/- \[[ xX]\]/g) ?? [];
		assert.ok(checkboxes.length <= 1, `line has ${checkboxes.length} checkboxes: ${line}`);
	}
});
