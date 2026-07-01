#!/usr/bin/env node
/* =========================================================================
   Langflow scheduled-task runner (headless)

   Runs the same fixed prompt against a Langflow flow on a repeating
   schedule — the always-on counterpart to the in-browser scheduler.

   Usage:
     node run-schedules.mjs                 # resident loop, checks every 30s
     node run-schedules.mjs --once          # fire anything due now, then exit
                                            #   (drive from cron / Task Scheduler)
     node run-schedules.mjs --file my.json  # use a specific schedules file

   Schedules file: the JSON exported from the launcher's Schedule tab
   ("Export for runner"), or hand-written — see schedules.example.json.

   Requires Node 18+ (uses built-in fetch). No npm install needed.
   ========================================================================= */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ---- Args --------------------------------------------------------------- */
const args = process.argv.slice(2);
const runOnce = args.includes("--once");
const fileFlagIdx = args.indexOf("--file");
const scheduleFile =
  fileFlagIdx !== -1 && args[fileFlagIdx + 1]
    ? resolvePath(args[fileFlagIdx + 1])
    : join(__dirname, "schedules.json");
const stateFile = join(__dirname, "runner-state.json");
const LOOP_MS = 30000;

function resolvePath(p) {
  return isAbsolute(p) ? p : join(process.cwd(), p);
}

/* ---- Logging ------------------------------------------------------------ */
function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`${ts} [${level}] ${msg}`);
}

/* ---- Schedule math (mirrors the browser scheduler) ---------------------- */
function intervalMs(task) {
  const n = Math.max(1, Number(task.intervalN) || 1);
  return task.freq === "minutes" ? n * 60000 : n * 3600000;
}

function computeNextRun(task, from) {
  if (task.freq === "minutes" || task.freq === "hours") {
    return from + intervalMs(task);
  }
  const [hh, mm] = (task.timeOfDay || "09:00").split(":").map(Number);
  const next = new Date(from);
  next.setHours(hh, mm, 0, 0);

  if (task.freq === "daily") {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  const target = Number(task.weekday);
  let dayDiff = (target - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next.getTime() <= from) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next.getTime();
}

/* ---- State (survives restarts so daily/weekly runs aren't lost) --------- */
function loadState() {
  if (!existsSync(stateFile)) return {};
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}
function saveState(state) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/* ---- Load schedules ----------------------------------------------------- */
function loadSchedules() {
  if (!existsSync(scheduleFile)) {
    log("error", `Schedules file not found: ${scheduleFile}`);
    log("info", "Export one from the launcher's Schedule tab, or copy schedules.example.json to schedules.json.");
    process.exit(1);
  }
  try {
    const tasks = JSON.parse(readFileSync(scheduleFile, "utf8"));
    if (!Array.isArray(tasks)) throw new Error("expected a JSON array of tasks");
    return tasks;
  } catch (err) {
    log("error", `Could not parse ${scheduleFile}: ${err.message}`);
    process.exit(1);
  }
}

/* ---- Response parsing --------------------------------------------------- */
function extractOutputText(data) {
  try {
    const out = data?.outputs?.[0]?.outputs?.[0];
    return (
      out?.results?.message?.text ||
      out?.results?.message?.data?.text ||
      out?.outputs?.message?.message ||
      out?.messages?.[0]?.message ||
      out?.artifacts?.message ||
      JSON.stringify(data).slice(0, 300)
    );
  } catch {
    return "(ran, response unparsed)";
  }
}

/* ---- Fire one task ------------------------------------------------------ */
async function runTask(task) {
  const host = String(task.host || "").replace(/\/+$/, "");
  const url = `${host}/api/v1/run/${task.flowId}?stream=false`;
  log("run", `"${task.name}" → ${host}/…/${task.flowId}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": task.apiKey,
      },
      body: JSON.stringify({
        input_value: task.prompt,
        output_type: "chat",
        input_type: "chat",
        session_id: `runner-${task.name}`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }

    const data = await res.json();
    const text = extractOutputText(data);
    log("ok", `"${task.name}" → ${String(text).replace(/\s+/g, " ").slice(0, 220)}`);
    return true;
  } catch (err) {
    log("error", `"${task.name}" → ${err.message}`);
    return false;
  }
}

/* ---- One scheduling pass ------------------------------------------------ */
async function pass() {
  const tasks = loadSchedules();
  const state = loadState();
  const now = Date.now();

  for (const task of tasks) {
    if (task.enabled === false) continue;
    const key = task.name; // names should be unique across your schedules
    if (!state[key]) {
      state[key] = { lastRun: null, nextRun: computeNextRun(task, now) };
      log("info", `Registered "${task.name}" — first run ${new Date(state[key].nextRun).toISOString()}`);
      continue;
    }

    if (now >= state[key].nextRun) {
      await runTask(task);
      state[key].lastRun = now;
      state[key].nextRun = computeNextRun(task, Date.now());
      log("info", `"${task.name}" next run ${new Date(state[key].nextRun).toISOString()}`);
    }
  }

  saveState(state);
}

/* ---- Entry -------------------------------------------------------------- */
async function main() {
  log("info", `Runner starting — schedules: ${scheduleFile}`);
  if (runOnce) {
    await pass();
    log("info", "Single pass complete.");
    return;
  }
  await pass();
  setInterval(() => {
    pass().catch((err) => log("error", `pass failed: ${err.message}`));
  }, LOOP_MS);
  log("info", `Resident mode — checking every ${LOOP_MS / 1000}s. Ctrl+C to stop.`);
}

main().catch((err) => {
  log("error", err.stack || err.message);
  process.exit(1);
});
