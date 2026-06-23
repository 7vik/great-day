import { moment } from 'obsidian';

/** Returns today's date as a moment object. */
export function today(): moment.Moment {
	return moment();
}

/** Formats a date using the plugin's date format. */
export function formatDate(date: moment.Moment, format: string): string {
	return date.format(format);
}

/** Returns the day-of-week name (e.g. "Mon", "Tue") matching the food plan table. */
export function dayShort(date: moment.Moment): string {
	return date.format('ddd'); // Mon, Tue, Wed…
}

/** Returns the full day name (e.g. "Monday"). */
export function dayLong(date: moment.Moment): string {
	return date.format('dddd');
}

/** Days remaining in the current week (including today). */
export function daysLeftInWeek(date: moment.Moment): number {
	// ISO week: Monday = 1 … Sunday = 7
	const dow = date.isoWeekday(); // 1–7
	return 8 - dow; // Monday → 7, Sunday → 1
}

/** Days remaining in the current month (including today). */
export function daysLeftInMonth(date: moment.Moment): number {
	return date.daysInMonth() - date.date() + 1;
}

/** Days remaining in the current year (including today). */
export function daysLeftInYear(date: moment.Moment): number {
	const endOfYear = moment().endOf('year');
	return endOfYear.diff(date, 'days') + 1;
}

/** Returns the date string for "tomorrow" (for midnight detection). */
export function tomorrowFormatted(format: string): string {
	return moment().add(1, 'day').format(format);
}

/** Checks whether it's the first day of the week (Monday). */
export function isStartOfWeek(date: moment.Moment): boolean {
	return date.isoWeekday() === 1;
}
