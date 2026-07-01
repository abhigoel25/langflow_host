# Langflow scheduled-task runner

The **always-on** counterpart to the launcher's **Schedule** tab.

The in-browser scheduler only fires while the page is open — great for demos
and "while I'm at my desk," but a closed tab or a sleeping laptop means a
missed run. This runner executes the same schedules headless on any machine
that stays on, so "daily at 9am" and "every N hours" fire reliably.

Both use the identical schedule format and hit the same Langflow endpoint:
`POST {host}/api/v1/run/{flowId}` with an `x-api-key` header and the fixed
prompt as `input_value`.

## Requirements

- **Node 18+** (uses built-in `fetch` — no `npm install`).

## Setup

1. In the launcher → **Schedule** tab, create your tasks, then click
   **Export for runner**. Save the downloaded `schedules.json` next to
   `run-schedules.mjs`.
   *(Or copy `schedules.example.json` to `schedules.json` and edit it.)*

2. Run it.

## Running

**Resident mode** — one long-lived process that checks every 30s:

```bash
node run-schedules.mjs
```

Leave it running (or run it under a process manager / as a service). This is
the simplest always-on setup.

**One-shot mode** — fire anything currently due, then exit. Meant to be driven
by the OS scheduler once a minute:

```bash
node run-schedules.mjs --once
```

Use a specific file:

```bash
node run-schedules.mjs --once --file /path/to/schedules.json
```

State (each task's last/next run) is persisted to `runner-state.json` so
`--once` invocations pick up where the last one left off, and daily/weekly
runs survive restarts.

### Windows Task Scheduler (drive `--once` every minute)

Create a task that runs at every-minute repetition:

```powershell
$node = (Get-Command node).Source
$here = "C:\path\to\langflow_host\runner"
$action  = New-ScheduledTaskAction -Execute $node -Argument "run-schedules.mjs --once" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Langflow scheduler" -Action $action -Trigger $trigger
```

### cron (macOS / Linux, drive `--once` every minute)

```cron
* * * * * cd /path/to/langflow_host/runner && /usr/bin/node run-schedules.mjs --once >> runner.log 2>&1
```

## Schedule format

Array of task objects (see `schedules.example.json`):

| field        | meaning                                                        |
| ------------ | ------------------------------------------------------------- |
| `name`       | Unique label. Used as the state key — **keep names distinct**. |
| `host`       | Langflow host URL, e.g. `http://localhost:7860`.               |
| `flowId`     | The flow to run.                                               |
| `apiKey`     | Langflow API key (the one that runs flows).                    |
| `prompt`     | Fixed text sent as the chat input every run.                  |
| `freq`       | `minutes` \| `hours` \| `daily` \| `weekly`.                   |
| `intervalN`  | For `minutes`/`hours`: run every N of them.                    |
| `timeOfDay`  | For `daily`/`weekly`: `"HH:MM"` in the machine's local time.   |
| `weekday`    | For `weekly`: `0`=Sun … `6`=Sat.                              |
| `enabled`    | `false` to keep the entry but skip it.                        |

## Security note

`schedules.json` and `runner-state.json` contain **API keys** — keep them out
of version control and off shared machines. A `.gitignore` in this folder
already excludes them.
