# Great Day

An Obsidian plugin that syncs your daily notes with your TODOs file. When you create a new daily note, it pulls in today's exercise plan, food plan, and a smart sample of week/month/year tasks. At midnight, it syncs back — checking off completed tasks in your TODOs and appending any new tasks you added during the day.

## How it works

### Daily note creation

Run the **Create today's daily note** command (or **Create daily note for…** to pick a date). The plugin reads your `TODOs.md` and generates a daily note with:

1. **Exercise** — the exercise routine for today's day of the week
2. **Food** — the food plan row for today's day of the week
3. **Today** — any day-scope tasks from your TODOs
4. **This week** — a sampled subset of your week tasks (proportional to days left)
5. **This month** — a sampled subset of your month tasks
6. **This year** — a sampled subset of your year tasks
7. **Weekly review** — if today is your configured review day (default: Monday)
8. **New tasks** — a section where you add new tasks with scope tags

### Task sampling

For week/month/year tasks, the plugin shows `ceil(total_tasks / days_remaining)` tasks — so if there are 10 week tasks and 3 days left (including today), you'll see ~4 tasks. This ensures you work through tasks at a steady pace without being overwhelmed.

### New tasks

In the **New tasks** section of your daily note, add tasks with a scope tag at the end:

- `- [ ] Buy groceries (D)` → goes to the **Day** section of TODOs
- `- [ ] Write blog post (W)` → goes to the **Week** section
- `- [ ] Read paper (M)` → goes to the **Month** section
- `- [ ] Plan trip (Y)` → goes to the **Year** section

### Midnight rollover

At midnight (or when Obsidian starts the next day), the plugin syncs yesterday's daily note:

- **Checked tasks** → marked as done in TODOs
- **Unchecked tasks** → stay in TODOs (automatically rolled back)
- **New tagged tasks** → appended to the appropriate TODOs section

## TODOs.md format

Your TODOs file should have these sections:

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

# Week
- [ ] task...

# Month
- [ ] task...

# Year
- [ ] task...
```

## Settings

- **Todos file path** — path to your TODOs file (default: `TODOs.md`)
- **Daily notes folder** — where daily notes are stored (default: `Daily Notes`)
- **Date format** — moment.js format for filenames (default: `YYYY-MM-DD`)
- **Week/Month/Year tasks to show** — override the auto-sampling count
- **Auto rollover at midnight** — enable/disable automatic syncing
- **Weekly todos review** — add a review task on a specific day each week
- **New tasks heading** — heading text for the new-tasks section

## Commands

- **Create today's daily note** — generates and opens today's note
- **Create daily note for…** — pick a date and generate that note
- **Sync yesterday's tasks back to todos** — manually trigger the rollover sync
