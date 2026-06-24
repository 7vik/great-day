import { moment } from 'obsidian';

/** A parsed calendar event. */
export interface CalendarEvent {
	summary: string;
	start: moment.Moment;
	end: moment.Moment;
	allDay: boolean;
}

/** Unfolds ICS line continuations (lines starting with space/tab are continuations). */
function unfoldLines(raw: string): string[] {
	const lines = raw.split(/\r?\n/);
	const result: string[] = [];
	for (const line of lines) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && result.length > 0) {
			result[result.length - 1] += line.slice(1);
		} else {
			result.push(line);
		}
	}
	return result;
}

/** Parses an ICS date-time value (e.g. 20260624T140000Z or 20260624). */
function parseIcsDate(value: string): { date: moment.Moment; allDay: boolean } {
	if (value.includes('T')) {
		// Date-time: 20260624T140000Z or 20260624T140000
		const utc = value.endsWith('Z');
		const clean = utc ? value.slice(0, -1) : value;
		const d = moment(clean, 'YYYYMMDDTHHmmss');
		if (utc) d.utc();
		return { date: d, allDay: false };
	}
	// Date only: 20260624
	return { date: moment(value, 'YYYYMMDD'), allDay: true };
}

/** Parses ICS text and returns events that fall on the given date. */
export function parseIcsForDate(icsRaw: string, targetDate: moment.Moment): CalendarEvent[] {
	const lines = unfoldLines(icsRaw);
	const events: CalendarEvent[] = [];
	const targetDay = targetDate.clone().startOf('day');

	let inEvent = false;
	let summary = '';
	let dtStart: moment.Moment | null = null;
	let dtEnd: moment.Moment | null = null;
	let allDay = false;

	for (const line of lines) {
		const upper = line.toUpperCase();

		if (upper === 'BEGIN:VEVENT') {
			inEvent = true;
			summary = '';
			dtStart = null;
			dtEnd = null;
			allDay = false;
			continue;
		}

		if (upper === 'END:VEVENT') {
			if (inEvent && summary && dtStart) {
				// Check if event falls on target date
				const eventStartDay = dtStart.clone().startOf('day');
				const eventEndDay = dtEnd ? dtEnd.clone().startOf('day') : eventStartDay;

				// Event is on target day if it starts that day, or spans across it
				if (targetDay.isSameOrAfter(eventStartDay) && targetDay.isSameOrBefore(eventEndDay)) {
					events.push({
						summary,
						start: dtStart,
						end: dtEnd ?? dtStart,
						allDay,
					});
				}
			}
			inEvent = false;
			continue;
		}

		if (!inEvent) continue;

		if (upper.startsWith('SUMMARY:')) {
			summary = line.slice('SUMMARY:'.length);
		} else if (upper.startsWith('DTSTART')) {
			const colonIdx = line.indexOf(':');
			if (colonIdx >= 0) {
				const value = line.slice(colonIdx + 1);
				const parsed = parseIcsDate(value);
				dtStart = parsed.date;
				allDay = parsed.allDay;
			}
		} else if (upper.startsWith('DTEND')) {
			const colonIdx = line.indexOf(':');
			if (colonIdx >= 0) {
				const value = line.slice(colonIdx + 1);
				dtEnd = parseIcsDate(value).date;
			}
		}
	}

	// Sort by start time
	events.sort((a, b) => a.start.valueOf() - b.start.valueOf());
	return events;
}
