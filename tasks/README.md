# Task tracking (markdown)

Simple markdown-based task system for daily focus, weekly summaries, and backlog.

## Folder structure

| Path | Purpose |
|------|--------|
| `tasks/daily/` | One file per day: `YYYY-MM-DD.md` |
| `tasks/weekly/` | Weekly summaries (e.g. `2025-W07.md`) |
| `tasks/archive/` | Old daily/weekly files moved here when done |
| `tasks/backlog.md` | Future tasks and ideas |

## Open today’s task file

From the **project root**:

```bash
./scripts/new-task.sh
```

- Uses **today’s date** (e.g. `tasks/daily/2025-02-16.md`).
- If the file doesn’t exist, it’s created from the template.
- Opens the file in Cursor if the `cursor` CLI is available.

To use a specific date, you can run with `TZ` or change the script; by default it uses the system date.

## Search historical tasks

From the project root:

```bash
# All daily task files
ls tasks/daily/

# Full-text search in daily tasks
grep -r "search term" tasks/daily/

# Or with ripgrep (rg) for line numbers
rg "search term" tasks/daily/

# Search in backlog too
rg "search term" tasks/
```

## Suggested daily workflow

1. **Morning**  
   Run `./scripts/new-task.sh`. Fill **Today’s Focus** with 1–3 main goals. Move anything in progress from yesterday into **In Progress** or **Today’s Focus**.

2. **During the day**  
   Move items from **Today’s Focus** to **In Progress**, then to **Completed ✓**. Add **Blockers/Notes** as needed.

3. **End of day**  
   Under **Tomorrow**, note 1–3 things to do next. Optionally move completed day files to `tasks/archive/` when starting a new week.

4. **Backlog**  
   Keep `tasks/backlog.md` for ideas and future work; promote items from there into a day’s **Today’s Focus** when you’re ready.

## Weekly summaries (optional)

In `tasks/weekly/` you can add files like `2025-W07.md` with a short recap: what shipped, what was learned, what’s next. Move or copy content from the week’s daily files if that helps.
