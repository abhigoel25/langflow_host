/* =========================================================================
   Agent Launchpad — scheduled tasks
   Runs one fixed prompt against a Langflow flow on a repeating schedule,
   for as long as this page stays open. Export to the Node runner for
   always-on execution.
   ========================================================================= */

const SCHED_KEY = "langflowSchedules";
const LOG_KEY = "langflowRunLog";
const TICK_MS = 15000; // how often we check for due tasks
const LOG_CAP = 120;

/* ---- Element handles ---------------------------------------------------- */
const launchViewTab = document.querySelector("#launchViewTab");
const scheduleViewTab = document.querySelector("#scheduleViewTab");
const viewLaunch = document.querySelector("#viewLaunch");
const viewSchedule = document.querySelector("#viewSchedule");

const taskName = document.querySelector("#taskName");
const taskSnippet = document.querySelector("#taskSnippet");
const taskKey = document.querySelector("#taskKey");
const taskPrompt = document.querySelector("#taskPrompt");
const toggleTaskKeyBtn = document.querySelector("#toggleTaskKeyBtn");

const freqTabs = [...document.querySelectorAll(".freq-tab")];
const intervalConfig = document.querySelector("#intervalConfig");
const intervalN = document.querySelector("#intervalN");
const intervalUnit = document.querySelector("#intervalUnit");
const timeConfig = document.querySelector("#timeConfig");
const timeOfDay = document.querySelector("#timeOfDay");
const weekdayConfig = document.querySelector("#weekdayConfig");
const weekday = document.querySelector("#weekday");

const addTaskBtn = document.querySelector("#addTaskBtn");
const resetTaskBtn = document.querySelector("#resetTaskBtn");
const taskError = document.querySelector("#taskError");

const schedulerChip = document.querySelector("#schedulerChip");
const exportBtn = document.querySelector("#exportBtn");
const telTaskCount = document.querySelector("#telTaskCount");
const telNextRun = document.querySelector("#telNextRun");
const telRunCount = document.querySelector("#telRunCount");
const emptyTasks = document.querySelector("#emptyTasks");
const schedBody = document.querySelector("#schedBody");
const taskList = document.querySelector("#taskList");
const runLog = document.querySelector("#runLog");
const clearLogBtn = document.querySelector("#clearLogBtn");

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let activeFreq = "hours";
let tasks = load(SCHED_KEY, []);
let logEntries = load(LOG_KEY, []);

/* ---- Storage helpers ---------------------------------------------------- */
function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function persist() {
  localStorage.setItem(SCHED_KEY, JSON.stringify(tasks));
  localStorage.setItem(LOG_KEY, JSON.stringify(logEntries.slice(0, LOG_CAP)));
}
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ---- Workspace view switching ------------------------------------------- */
function setView(view) {
  const scheduling = view === "schedule";
  launchViewTab.setAttribute("aria-selected", String(!scheduling));
  scheduleViewTab.setAttribute("aria-selected", String(scheduling));
  viewLaunch.classList.toggle("active", !scheduling);
  viewSchedule.classList.toggle("active", scheduling);
  viewLaunch.hidden = scheduling;
  viewSchedule.hidden = !scheduling;
}
launchViewTab.addEventListener("click", () => setView("launch"));
scheduleViewTab.addEventListener("click", () => setView("schedule"));

/* ---- Frequency selector ------------------------------------------------- */
function setFreq(freq) {
  activeFreq = freq;
  freqTabs.forEach((tab) =>
    tab.setAttribute("aria-selected", String(tab.dataset.freq === freq))
  );
  const isInterval = freq === "minutes" || freq === "hours";
  intervalConfig.hidden = !isInterval;
  timeConfig.hidden = !(freq === "daily" || freq === "weekly");
  weekdayConfig.hidden = freq !== "weekly";
  intervalUnit.textContent = freq === "minutes" ? "minutes" : "hours";
}
freqTabs.forEach((tab) =>
  tab.addEventListener("click", () => setFreq(tab.dataset.freq))
);

/* ---- Schedule math ------------------------------------------------------ */
function intervalMs(task) {
  const n = Math.max(1, Number(task.intervalN) || 1);
  return task.freq === "minutes" ? n * 60000 : n * 3600000;
}

// Next fire time strictly after `from` (ms). For interval tasks this is
// `from + interval`; for daily/weekly it's the next matching wall-clock time.
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

  // weekly
  const target = Number(task.weekday);
  let dayDiff = (target - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next.getTime() <= from) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next.getTime();
}

function cadenceLabel(task) {
  if (task.freq === "minutes")
    return `Every ${task.intervalN} min`;
  if (task.freq === "hours")
    return `Every ${task.intervalN} ${task.intervalN === 1 ? "hour" : "hours"}`;
  if (task.freq === "daily") return `Daily · ${task.timeOfDay}`;
  return `${WEEKDAY_NAMES[Number(task.weekday)]} · ${task.timeOfDay}`;
}

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/* ---- Task creation ------------------------------------------------------ */
function clearTaskError() {
  taskError.style.display = "none";
  taskError.textContent = "";
}
function showTaskError(message) {
  taskError.textContent = message;
  taskError.style.display = "block";
}

// Pull host, flow ID, and (optionally) the API key out of a Langflow embed
// snippet — the same snippet used on the Launch tab.
function parseSnippet(raw) {
  const doc = new DOMParser().parseFromString(raw || "", "text/html");
  const chat = doc.querySelector("langflow-chat");
  if (!chat)
    throw new Error(
      "Paste the full Langflow embed snippet, including the <langflow-chat …> tag."
    );
  const host = (chat.getAttribute("host_url") || "").trim().replace(/\/+$/, "");
  const flowId = (chat.getAttribute("flow_id") || "").trim();
  const key = (chat.getAttribute("api_key") || "").trim();
  if (!host || !flowId)
    throw new Error("The snippet is missing host_url or flow_id.");
  return { host, flowId, key };
}

function addTask() {
  clearTaskError();
  const name = taskName.value.trim();
  const prompt = taskPrompt.value.trim();

  if (!name) return showTaskError("Give the task a name.");

  let parsed;
  try {
    parsed = parseSnippet(taskSnippet.value);
  } catch (err) {
    return showTaskError(err.message);
  }
  const host = parsed.host;
  const flowId = parsed.flowId;
  const apiKey = taskKey.value.trim() || parsed.key;

  if (!apiKey)
    return showTaskError(
      "Add a Langflow API key, or include api_key in the snippet."
    );
  if (!prompt) return showTaskError("Add the prompt to run each time.");

  const n = Math.max(1, Math.floor(Number(intervalN.value) || 1));
  const task = {
    id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    host,
    flowId,
    apiKey,
    prompt,
    freq: activeFreq,
    intervalN: n,
    timeOfDay: timeOfDay.value || "09:00",
    weekday: Number(weekday.value),
    enabled: true,
    createdAt: Date.now(),
    lastRun: null,
    lastStatus: null,
    lastMessage: "",
  };
  task.nextRun = computeNextRun(task, Date.now());

  tasks.push(task);
  persist();
  render();
  resetTaskForm();
  addLog(task, "info", `Scheduled — first run ${fmtTime(task.nextRun)}.`);
}

function resetTaskForm() {
  taskName.value = "";
  taskPrompt.value = "";
  clearTaskError();
}

/* ---- Task actions ------------------------------------------------------- */
function findTask(id) {
  return tasks.find((t) => t.id === id);
}
function toggleTask(id) {
  const task = findTask(id);
  if (!task) return;
  task.enabled = !task.enabled;
  if (task.enabled) task.nextRun = computeNextRun(task, Date.now());
  persist();
  render();
}
function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  persist();
  render();
}

/* ---- Running a flow ----------------------------------------------------- */
function extractOutputText(data) {
  try {
    const out = data?.outputs?.[0]?.outputs?.[0];
    return (
      out?.results?.message?.text ||
      out?.results?.message?.data?.text ||
      out?.outputs?.message?.message ||
      out?.messages?.[0]?.message ||
      out?.artifacts?.message ||
      (typeof data === "string" ? data : JSON.stringify(data).slice(0, 400))
    );
  } catch {
    return "(ran, but response could not be parsed)";
  }
}

async function runTask(task, trigger = "schedule") {
  task.running = true;
  render();
  const startLog = addLog(task, "running", `Running (${trigger})…`);

  try {
    const url = `${task.host}/api/v1/run/${task.flowId}?stream=false`;
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
        session_id: `sched-${task.id}`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }

    const data = await res.json();
    const text = extractOutputText(data);
    task.lastStatus = "ok";
    task.lastMessage = text;
    updateLog(startLog, "ok", text);
  } catch (err) {
    const hint =
      err instanceof TypeError
        ? " (network/CORS — check the host URL is reachable and allows this origin)"
        : "";
    task.lastStatus = "error";
    task.lastMessage = err.message + hint;
    updateLog(startLog, "error", err.message + hint);
  } finally {
    task.running = false;
    task.lastRun = Date.now();
    if (task.enabled || trigger === "schedule") {
      task.nextRun = computeNextRun(task, Date.now());
    }
    persist();
    render();
  }
}

/* ---- The scheduler tick ------------------------------------------------- */
function tick() {
  const now = Date.now();
  tasks
    .filter((t) => t.enabled && !t.running && t.nextRun && now >= t.nextRun)
    .forEach((t) => runTask(t, "schedule"));
  updateNextRunTelemetry();
}

/* ---- Run log ------------------------------------------------------------ */
function addLog(task, status, message) {
  const entry = {
    id: `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    taskId: task.id,
    taskName: task.name,
    when: Date.now(),
    status,
    message,
  };
  logEntries.unshift(entry);
  logEntries = logEntries.slice(0, LOG_CAP);
  persist();
  renderLog();
  return entry.id;
}
function updateLog(entryId, status, message) {
  const entry = logEntries.find((e) => e.id === entryId);
  if (!entry) return;
  entry.status = status;
  entry.message = message;
  entry.when = Date.now();
  persist();
  renderLog();
}

/* ---- Rendering ---------------------------------------------------------- */
function render() {
  const enabled = tasks.filter((t) => t.enabled);
  const anyTasks = tasks.length > 0;

  emptyTasks.hidden = anyTasks;
  schedBody.hidden = !anyTasks;
  exportBtn.disabled = !anyTasks;

  telTaskCount.textContent = String(enabled.length);
  telRunCount.textContent = String(
    logEntries.filter((e) => e.status === "ok" || e.status === "error").length
  );

  const running = tasks.some((t) => t.running);
  if (running) {
    schedulerChip.textContent = "Running";
    schedulerChip.setAttribute("data-state", "running");
  } else if (enabled.length) {
    schedulerChip.textContent = "Armed";
    schedulerChip.setAttribute("data-state", "live");
  } else {
    schedulerChip.textContent = "Idle";
    schedulerChip.setAttribute("data-state", "idle");
  }

  taskList.innerHTML = tasks.map(renderCard).join("");
  taskList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { action, id } = btn.dataset;
      if (action === "run") {
        const task = findTask(id);
        if (task && !task.running) runTask(task, "manual");
      } else if (action === "toggle") {
        toggleTask(id);
      } else if (action === "delete") {
        deleteTask(id);
      }
    });
  });

  updateNextRunTelemetry();
}

function renderCard(task) {
  const status = task.running
    ? '<span class="running">running…</span>'
    : task.lastStatus === "ok"
      ? '<span class="ok">ok</span>'
      : task.lastStatus === "error"
        ? '<span class="fail">failed</span>'
        : "—";
  const playIcon = task.enabled
    ? '<path d="M8 6h3v12H8zM13 6h3v12h-3z" />' // pause
    : '<path d="M7 5l12 7-12 7z" />'; // play
  return `
    <div class="task-card" data-enabled="${task.enabled}">
      <div class="task-card-top">
        <div>
          <p class="task-card-name">${escapeHtml(task.name)}</p>
          <p class="task-card-cadence">${escapeHtml(cadenceLabel(task))}</p>
        </div>
        <div class="task-card-actions">
          <button class="icon-btn" title="Run now" data-action="run" data-id="${task.id}" ${task.running ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          </button>
          <button class="icon-btn" title="${task.enabled ? "Pause" : "Resume"}" data-action="toggle" data-id="${task.id}">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${playIcon}</svg>
          </button>
          <button class="icon-btn danger" title="Delete" data-action="delete" data-id="${task.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12h10l1-12" /></svg>
          </button>
        </div>
      </div>
      <p class="task-card-prompt">${escapeHtml(task.prompt)}</p>
      <div class="task-card-meta">
        <span>next <b>${task.enabled ? fmtTime(task.nextRun) : "paused"}</b></span>
        <span>last <b>${fmtTime(task.lastRun)}</b></span>
        <span>status ${status}</span>
      </div>
    </div>`;
}

function renderLog() {
  runLog.innerHTML = logEntries
    .map(
      (e) => `
      <div class="log-entry" data-status="${e.status}">
        <span class="log-when">${fmtTime(e.when)}</span>
        <div class="log-main">
          <div class="log-task">${escapeHtml(e.taskName)}</div>
          <div class="log-msg">${escapeHtml(e.message)}</div>
        </div>
      </div>`
    )
    .join("");
  telRunCount.textContent = String(
    logEntries.filter((e) => e.status === "ok" || e.status === "error").length
  );
}

function updateNextRunTelemetry() {
  const upcoming = tasks
    .filter((t) => t.enabled && t.nextRun)
    .map((t) => t.nextRun)
    .sort((a, b) => a - b)[0];
  telNextRun.textContent = upcoming ? fmtTime(upcoming) : "—";
}

/* ---- Export for the Node runner ----------------------------------------- */
function exportSchedules() {
  const payload = tasks.map((t) => ({
    name: t.name,
    host: t.host,
    flowId: t.flowId,
    apiKey: t.apiKey,
    prompt: t.prompt,
    freq: t.freq,
    intervalN: t.intervalN,
    timeOfDay: t.timeOfDay,
    weekday: t.weekday,
    enabled: t.enabled,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "schedules.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---- Misc events -------------------------------------------------------- */
toggleTaskKeyBtn.addEventListener("click", () => {
  const hidden = taskKey.type === "password";
  taskKey.type = hidden ? "text" : "password";
  toggleTaskKeyBtn.textContent = hidden ? "Hide" : "Show";
  taskKey.focus();
});
addTaskBtn.addEventListener("click", addTask);
resetTaskBtn.addEventListener("click", resetTaskForm);
exportBtn.addEventListener("click", exportSchedules);
clearLogBtn.addEventListener("click", () => {
  logEntries = [];
  persist();
  renderLog();
});

/* ---- Boot --------------------------------------------------------------- */
setFreq("hours");
render();
renderLog();
tick(); // catch up any tasks already due on load
setInterval(tick, TICK_MS);
