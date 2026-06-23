import type { App } from 'obsidian';
import { TFile, Notice, normalizePath, moment } from 'obsidian';
import type { GreatDaySettings } from '../settings';
import {
	parseTodos,
	getFoodForDay,
	getExerciseForDay,
} from './todosParser';
import { sampleForScope } from './taskSampler';
import { dayShort, dayLong, formatDate } from './dateUtils';


/** Reads the TODOs file from the vault. */
async function readTodosFile(
	app: App,
	settings: GreatDaySettings,
): Promise<string> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.todosFilePath),
	);
	if (!file || !(file instanceof TFile)) {
		new Notice(
			`Great Day: TODOs file not found at "${settings.todosFilePath}". Create it or update the path in settings.`,
		);
		return '';
	}
	return app.vault.read(file);
}

/** Generates the daily note content. */
export async function generateDailyNoteContent(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
): Promise<string> {
	const raw = await readTodosFile(app, settings);
	if (!raw) return '';

	const data = parseTodos(raw);
	const dayName = dayShort(date);
	const fullDayName = dayLong(date);

	const sections: string[] = [];

	// Header
	const dateStr = formatDate(date, settings.dateFormat);
	sections.push(`# ${dateStr} — ${fullDayName}`);

	// Exercise plan
	const exercise = getExerciseForDay(data.exercisePlanText, fullDayName);
	if (exercise) {
		sections.push('## Exercise\n');
		sections.push(exercise);
	}

	// Food plan
	const foodLine = getFoodForDay(data.foodPlanLines, dayName);
	if (foodLine) {
		sections.push('## Food\n');
		sections.push(foodLine);
	}

	// Day tasks (from the Day section in TODOs, if any)
	const dayTasks = data.tasks.day.filter((t) => !t.done);
	if (dayTasks.length > 0) {
		sections.push('## Today\n');
		for (const t of dayTasks) {
			sections.push(t.raw);
		}
	}

	// Week tasks
	const weekTasks = sampleForScope(data.tasks.week, 'week', date);
	if (weekTasks.length > 0) {
		sections.push('## This week\n');
		for (const t of weekTasks) {
			sections.push(t.raw);
		}
	}

	// Month tasks
	const monthTasks = sampleForScope(data.tasks.month, 'month', date);
	if (monthTasks.length > 0) {
		sections.push('## This month\n');
		for (const t of monthTasks) {
			sections.push(t.raw);
		}
	}

	// Year tasks
	const yearTasks = sampleForScope(data.tasks.year, 'year', date);
	if (yearTasks.length > 0) {
		sections.push('## This year\n');
		for (const t of yearTasks) {
			sections.push(t.raw);
		}
	}

	// Weekly review task
	if (settings.weeklyReview) {
		const reviewDay = settings.weeklyReviewDay;
		// moment: 0=Sun, 1=Mon…6=Sat; settings uses same convention
		if (date.day() === reviewDay) {
			sections.push('## Weekly review\n');
			sections.push('- [ ] Review and update TODOs');
		}
	}

	// New tasks section (where user adds tasks with (D), (W), (M), (Y) tags)
	sections.push(`## ${settings.addTasksHeading}\n`);
	sections.push(
		'<!-- Add new tasks here with (D) for day, (W) for week, (M) for month, (Y) for year. -->',
	);
	sections.push('<!-- Example: - [ ] Buy groceries (D) -->');

	return sections.join('\n\n') + '\n';
}

/** Creates or opens the daily note for the given date. */
export async function createDailyNote(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
): Promise<TFile | null> {
	const dateStr = formatDate(date, settings.dateFormat);
	const folder = normalizePath(settings.dailyNotesFolder);
	const filePath = normalizePath(`${folder}/${dateStr}.md`);

	// Check if file already exists
	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing && existing instanceof TFile) {
		new Notice('Great day: daily note already exists, opening it.');
		await app.workspace.openLinkText(filePath, '', false);
		return existing;
	}

	// Ensure folder exists
	if (!app.vault.getAbstractFileByPath(folder)) {
		if (!app.vault.getAbstractFileByPath(folder)) {
			await app.vault.create(folder + '/.gitkeep', '');
		}
	}

	// Generate content
	const content = await generateDailyNoteContent(app, settings, date);
	const file = await app.vault.create(filePath, content);
	await app.workspace.openLinkText(filePath, '', false);
	return file;
}

/** Gets the daily note file for a given date (or null if it doesn't exist). */
export function getDailyNoteFile(
	app: App,
	settings: GreatDaySettings,
	date: moment.Moment,
): TFile | null {
	const dateStr = formatDate(date, settings.dateFormat);
	const folder = normalizePath(settings.dailyNotesFolder);
	const filePath = normalizePath(`${folder}/${dateStr}.md`);
	const file = app.vault.getAbstractFileByPath(filePath);
	if (file && file instanceof TFile) return file;
	return null;
}
