# tx — Semantic Task Management

`tx` is an AI-powered task management system that automatically extracts semantic structure from natural language task descriptions. Instead of manually categorizing and tagging tasks, simply describe what you need to do and `tx` discovers the structure for you.

## Philosophy

Traditional task managers require you to fit your tasks into predefined categories, tags, and fields. `tx` flips this: **you write naturally, and the system discovers the structure**.

Over time, `tx` learns:
- What projects you work on
- How you describe priorities
- Common task patterns (meetings, bug fixes, deployments)
- How long different types of tasks take you

This emergent semantic model becomes increasingly powerful for querying, filtering, and organizing your work.

---

## Installation

```bash
npm link      # After building the cx project
```

## Configuration

`tx` shares configuration with `cx` and `qx` at `~/.cx/config.json`. See the main README for provider setup.

## Storage

- **Tasks:** `~/.cx/tasks/<uuid>.json`
- **Index:** `~/.cx/tasks/index.json` (semantic structures, aliases, templates, stats)
- **Archive:** `~/.cx/tasks/archive/` (completed tasks)

---

## Adding Tasks

### Basic Usage

```bash
tx <natural language task description>
```

### Examples

```bash
tx update insurance definitions in supersonic before tuesday
tx call john about the quarterly review tomorrow - urgent
tx fix the login bug in webapp today
tx review PR for authentication feature
tx prepare slides for monday standup
tx buy groceries on the way home
```

### What Gets Extracted

The LLM analyzes your task and extracts fields like:

| Field | Description | Examples |
|-------|-------------|----------|
| `action` | Core verb/action | "update", "fix", "call", "review" |
| `subject` / `project` | Project or area | "supersonic", "webapp" |
| `deadline` | When it's due (auto-converts to ISO) | "2025-12-03", "tomorrow" |
| `priority` | Inferred urgency | "urgent", "high", "normal", "low" |
| `people` | People mentioned | "john", "sarah" |
| `context` | GTD-style contexts | "@computer", "@phone", "@errands" |
| `effort` | Estimated effort | "quick", "1hour", "half-day" |
| `energy` | Required energy level | "high", "medium", "low" |
| `task_type` | Type of task | "bug fix", "meeting", "deployment" |

The system also discovers **custom fields** unique to your workflow.

### Adding Dependencies

```bash
tx deploy webapp to production --blocks e965
```

This creates a task that blocks task `e965`. The blocked task will show a 🔒 indicator.

---

## Viewing Tasks

### List All Tasks

```bash
tx --list
```

### Smart Views

```bash
tx --today          # Due today
tx --week           # Due this week  
tx --overdue        # Past deadline
tx --blocked        # Tasks waiting on dependencies
tx --focus          # AI-prioritized (considers urgency, deadlines, blocking)
```

### Group By Field

```bash
tx --by project     # Group by project
tx --by context     # Group by context (@computer, @phone, etc.)
tx --by priority    # Group by priority level
tx --by task_type   # Group by type of task
```

### Structured Queries

```bash
tx --query <field> --eq <value>
tx --query subject --eq supersonic
tx --query priority --eq urgent
tx --query context --eq @computer
tx --query deadline --eq 2025-12-03
```

### Natural Language Queries

```bash
tx --q "what do I need to do for supersonic"
tx --q "urgent tasks this week"
tx --q "anything involving john"
tx --q "tasks by project"
```

The LLM translates your natural language into structured filters.

---

## Completing Tasks

```bash
tx --complete <task-id>
```

You can use any unique prefix of the task ID (like Docker):

```bash
tx --complete e965      # Matches e96517b9-...
```

### Completion Tracking

When completing a task, `tx` prompts for:

1. **Duration** — How long did it take? (e.g., `30min`, `2h`, `skip`)
2. **Notes** — Any notes? (or `skip`)

This data builds up over time to:
- Calculate average duration by task type
- Track completions by day and project
- Improve effort estimates

### Recurring Tasks

If a task has a recurrence pattern, completing it automatically creates the next occurrence:

```bash
tx check email every morning
# When completed → creates new task for tomorrow
```

---

## Semantic Discovery

### View Discovered Structures

```bash
tx --structures
```

Shows all fields the system has discovered across your tasks:

```
┌─ Discovered Structures ────────────────────────────┐

  action       string   (12x)
  "update", "fix", "call"

  subject      string   (10x)
  "supersonic", "webapp", "quarterly review"

  deadline     date     (8x)
  "2025-12-02", "2025-12-03"

  priority     string   (8x)
  "urgent", "high", "normal"

  task_type    string   (7x)
  "bug fix", "meeting", "data update"

└────────────────────────────────────────────────────┘
```

### View Aliases

```bash
tx --aliases
```

Shows detected name variations that map to canonical forms:

```
┌─ Known Aliases ────────────────────────────────────┐

  john_smith
  = John, john, John Smith

  supersonic
  = Supersonic, the supersonic project

└────────────────────────────────────────────────────┘
```

### Merge Aliases Manually

```bash
tx --merge <canonical> <variant>
tx --merge john "John Smith"
```

### View Templates

```bash
tx --templates
```

Shows discovered task patterns that repeat:

```
┌─ Task Templates ───────────────────────────────────┐

  standup      (5x)
  Pattern: "prepare slides for ... standup"
  Fields: task_type, context, effort

  bug_fix      (4x)
  Pattern: "fix ... bug in ..."
  Fields: task_type, project, component

└────────────────────────────────────────────────────┘
```

---

## Dependencies & Relationships

### Create Dependency

```bash
tx deploy webapp --blocks e965
```

Task `e965` is now blocked by the deploy task.

### View Blocked Tasks

```bash
tx --blocked
```

### View Dependency Graph

```bash
tx --graph
```

```
┌─ Dependency Graph ─────────────────────────────────┐

  bcb578bd Deploy webapp to production
    └─▶ e96517b9 fix login bug

└────────────────────────────────────────────────────┘
```

---

## Recurrence

`tx` automatically detects recurrence patterns:

```bash
tx check email every morning         # ↻ daily
tx review metrics every monday       # ↻ weekly on monday
tx pay rent on the 1st               # ↻ monthly on 1st
tx annual review in december         # ↻ yearly
```

When you complete a recurring task, the next occurrence is automatically created with an updated deadline.

---

## Review & Statistics

### Daily Review

```bash
tx --review
```

Shows an interactive overview:
- ⚠️ Overdue tasks
- 📅 Due today
- 🔒 Blocked tasks
- 🔥 Urgent tasks

### Statistics

```bash
tx --stats
```

```
┌─ Task Statistics ──────────────────────────────────┐

  Overall
  Created: 45  Completed: 38
  Completion rate: 84%

  By Project
  supersonic: 12 completed
  webapp: 8 completed

  Average Duration by Type
  bug fix: 45m
  meeting: 30m
  deployment: 2h

  Recent Activity
  2025-12-02: 5 completed
  2025-12-01: 3 completed

└────────────────────────────────────────────────────┘
```

---

## Export

### JSON

```bash
tx --export json
```

Full structured export of all tasks.

### Markdown

```bash
tx --export markdown
```

```markdown
# Tasks

- [ ] update insurance definitions in supersonic
  📅 2025-12-02 📁 supersonic
- [ ] call john about quarterly review
  📅 2025-12-03 📁 quarterly review
- [x] fix login bug
  📅 2025-12-02 📁 webapp
```

### iCal

```bash
tx --export ical
```

Export tasks with deadlines as VTODO items for calendar apps.

---

## Command Reference

### Adding Tasks

| Command | Description |
|---------|-------------|
| `tx <task>` | Add a task |
| `tx <task> --blocks <id>` | Add task that blocks another |

### Views

| Command | Description |
|---------|-------------|
| `tx --list` | All open tasks |
| `tx --today` | Due today |
| `tx --week` | Due this week |
| `tx --overdue` | Past deadline |
| `tx --blocked` | Waiting on dependencies |
| `tx --focus` | AI-prioritized top 5 |

### Filtering & Grouping

| Command | Description |
|---------|-------------|
| `tx --by <field>` | Group by field |
| `tx --query <field> --eq <value>` | Filter by field |
| `tx --q "<natural language>"` | Natural language query |

### Task Management

| Command | Description |
|---------|-------------|
| `tx --complete <id>` | Complete task |
| `tx --graph` | Show dependency graph |

### Semantics

| Command | Description |
|---------|-------------|
| `tx --structures` | Show discovered fields |
| `tx --aliases` | Show name variations |
| `tx --merge <canonical> <variant>` | Merge aliases |
| `tx --templates` | Show task patterns |

### Review & Stats

| Command | Description |
|---------|-------------|
| `tx --review` | Daily review |
| `tx --stats` | Statistics |

### Export

| Command | Description |
|---------|-------------|
| `tx --export json` | JSON export |
| `tx --export markdown` | Markdown checklist |
| `tx --export ical` | iCal format |

---

## Tips

### Use Consistent Language

The more consistently you describe tasks, the better the semantic model becomes:
- "fix X bug in Y" → extracts task_type: bug fix, project: Y
- "call X about Y" → extracts task_type: communication, person: X

### Leverage Contexts

Use GTD-style contexts to filter by where/how you can work:
- `@computer` — needs a computer
- `@phone` — can do with just a phone
- `@errands` — while out and about
- `@home` — at home only

```bash
tx --query context --eq @phone
```

### Check Focus Daily

```bash
tx --focus
```

This intelligently ranks tasks by:
1. Overdue (+200 points)
2. Due today (+100 points)
3. Urgent priority (+100 points)
4. High priority (+50 points)
5. Blocking other tasks (+40 per blocked task)
6. Being blocked (-50 points)

### Complete Tasks Properly

Always use `tx --complete` rather than deleting tasks. This:
- Archives the task for history
- Tracks duration for estimates
- Triggers recurrence if applicable
- Updates statistics

---

## Future Ideas

- **Import from email** — scan inbox for action items
- **Calendar sync** — two-way sync with calendar
- **Team mode** — shared semantic models
- **Mobile companion** — quick capture app
- **Voice input** — add tasks by speaking

