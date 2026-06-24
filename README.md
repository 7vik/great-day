# Great Day

An Obsidian plugin that syncs your daily notes with your TODOs file. When you create a new daily note, it pulls in today's exercise plan, food plan, and a smart sample of week/month/year tasks. At midnight (or on demand), it syncs back — removing completed tasks from your TODOs and appending any new tasks you added during the day.

## How it works

### Daily note creation

Run the **Create today's daily note** command (or **Create daily note for…** to pick a date). The plugin reads your `TODOs.md` and generates a daily note with a checkbox tree:

1. **Exercise** — today's exercise routine as nested checkboxes
2. **Food** — today's lunch and dinner parsed from the food plan table
3. **Tasks** — a combination of:
   - Scheduled tasks matching today's date
   - All day-scope tasks
   - A sampled, shuffled subset of week/month/year tasks
4. **Weekly review** — if today is your configured review day (default: Monday)
5. **New tasks** — a section where you add new tasks with scope or date tags

### Task sampling

For week/month/year tasks, the plugin shows `ceil(total_tasks / days_remaining)` tasks — randomly selected and shuffled. If there are 10 week tasks and 3 days left (including today), you'll see ~4 tasks. Nested sub-tasks stay with their parent.

### New tasks

In the **New tasks** section of your daily note, add tasks with a tag at the end:

**Scope tags:**
- `- [ ] Buy groceries (D)` → goes to the **Day** section of TODOs
- `- [ ] Write blog post (W)` → goes to the **Week** section
- `- [ ] Read paper (M)` → goes to the **Month** section
- `- [ ] Plan trip (Y)` → goes to the **Year** section

**Date tags:**
- `- [ ] Dentist appointment (15-07-2026)` → goes to the **Scheduled** section, shows up on 15 July 2026

If you tick off a new task on the same day, it won't be added to TODOs at all.

### Rollover

At midnight (or when you run **End day**), the plugin syncs the daily note:

- **Checked tasks** → removed from TODOs (including sub-tasks)
- **Unchecked tasks** → stay in TODOs (automatically rolled back)
- **New tagged tasks** → appended to the appropriate TODOs section
- **New date-tagged tasks** → appended to **# Scheduled** in TODOs

## TODOs.md format

```markdown
# Food Plan
| Day | ... | ... |
| ... | ... | ... |

# Exercise Plan
Monday to Friday:
- ...
Saturday:
- ...
Sunday:
- ...

# Day
- [ ] task...

# Week
- [ ] task...

# Month
- [ ] task...

# Year
- [ ] task...

# Scheduled
- [ ] task (DD-MM-YYYY)
```

## Settings

- **Todos file path** — path to your TODOs file (default: `TODOs.md`)
- **Daily notes folder** — where daily notes are stored (default: `Daily Notes/{{year}}`)
- **Date format** — moment.js format for filenames (default: `YYYY-MM-DD`)
- **Auto rollover at midnight** — enable/disable automatic syncing
- **Weekly todos review** — add a review task on a specific day each week
- **New tasks heading** — heading text for the new-tasks section

## Commands

- **Create today's daily note** — generates and opens today's note
- **Create daily note for…** — pick a date and generate that note
- **End day** — manually trigger the rollover sync for today
- **Sync yesterday's tasks back to todos** — manually trigger rollover for yesterday
