/* =========================================================================
   Agent Launchpad — launcher logic
   ========================================================================= */

const DEFAULT_SCRIPT_URL =
  "https://cdn.jsdelivr.net/gh/langflow-ai/langflow-embedded-chat@v1.0.8/dist/build/static/js/bundle.min.js";

const widgetDefaults = {
  chat_position: "bottom-right",
  start_open: "true",
  height: "620",
  width: "420",
  placeholder: "Ask your agent a question...",
  placeholder_sending: "Thinking...",
  online: "true",
  online_message: "Agent online",
  chat_trigger_style: {
    backgroundColor: "#ffb224",
    color: "#241803",
    borderRadius: "999px",
    boxShadow: "0 16px 34px rgba(255, 178, 36, 0.4)",
  },
  chat_window_style: {
    backgroundColor: "#11151f",
    border: "1px solid #2e3a4f",
    borderRadius: "18px",
    boxShadow: "0 28px 70px rgba(0, 0, 0, 0.55)",
    color: "#eef2fa",
  },
  user_message_style: {
    backgroundColor: "#ffb224",
    color: "#241803",
    borderRadius: "14px",
    padding: "10px 13px",
  },
  bot_message_style: {
    backgroundColor: "#161b27",
    color: "#eef2fa",
    borderRadius: "14px",
    border: "1px solid #232b3b",
    padding: "10px 13px",
  },
  input_container_style: {
    backgroundColor: "#11151f",
    borderTop: "1px solid #232b3b",
    padding: "12px",
  },
  // backgroundColor here is the fix for invisible (white-on-white) typed text
  input_style: {
    backgroundColor: "#161b27",
    color: "#eef2fa",
    border: "1px solid #2e3a4f",
    borderRadius: "12px",
    padding: "11px 13px",
  },
  send_button_style: {
    backgroundColor: "#ffb224",
    color: "#241803",
    borderRadius: "12px",
  },
  send_icon_style: {
    color: "#241803",
  },
  error_message_style: {
    backgroundColor: "rgba(255, 111, 97, 0.12)",
    color: "#ffb3aa",
    borderRadius: "12px",
  },
};

const snippetTab = document.querySelector("#snippetTab");
const flowTab = document.querySelector("#flowTab");
const snippetMode = document.querySelector("#snippetMode");
const flowMode = document.querySelector("#flowMode");
const snippet = document.querySelector("#snippet");
const hostUrl = document.querySelector("#hostUrl");
const flowId = document.querySelector("#flowId");
const scriptUrl = document.querySelector("#scriptUrl");
const agentTitle = document.querySelector("#agentTitle");
const apiKey = document.querySelector("#apiKey");
const toggleKeyBtn = document.querySelector("#toggleKeyBtn");
const launchBtn = document.querySelector("#launchBtn");
const clearBtn = document.querySelector("#clearBtn");
const openBtn = document.querySelector("#openBtn");
const previewFrame = document.querySelector("#previewFrame");
const emptyPreview = document.querySelector("#emptyPreview");
const previewTitle = document.querySelector("#previewTitle");
const previewSubhead = document.querySelector("#previewSubhead");
const previewChip = document.querySelector("#previewChip");
const sequence = document.querySelector("#sequence");
const statusEl = document.querySelector("#status");
const statusText = document.querySelector("#statusText");
const telHost = document.querySelector("#telHost");
const telFlow = document.querySelector("#telFlow");
const telState = document.querySelector("#telState");
const error = document.querySelector("#error");

let activeMode = "snippet";
let currentPreviewHtml = "";

const saved = JSON.parse(localStorage.getItem("langflowLauncher") || "{}");
snippet.value = "";
hostUrl.value = saved.hostUrl || "";
flowId.value = saved.flowId || "";
scriptUrl.value = saved.scriptUrl || DEFAULT_SCRIPT_URL;
agentTitle.value = saved.agentTitle || "My Agent";

/* ---- UI state helpers --------------------------------------------------- */
function setStatus(text, state) {
  statusText.textContent = text;
  statusEl.setAttribute("data-state", state);
}

function setMode(mode) {
  activeMode = mode;
  const snippetActive = mode === "snippet";
  snippetTab.setAttribute("aria-selected", snippetActive);
  flowTab.setAttribute("aria-selected", !snippetActive);
  snippetMode.classList.toggle("active", snippetActive);
  flowMode.classList.toggle("active", !snippetActive);
  snippetMode.hidden = !snippetActive;
  flowMode.hidden = snippetActive;
  clearError();
}

function clearError() {
  error.style.display = "none";
  error.textContent = "";
}

function showError(message) {
  error.textContent = message;
  error.style.display = "block";
  setStatus("Attention", "error");
}

/* ---- Snippet / field parsing (unchanged behavior) ----------------------- */
function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeHost(value) {
  return value.trim().replace(/\/+$/, "");
}

function getTitleFromChat(chat) {
  return (
    chat.getAttribute("window_title") ||
    chat.getAttribute("chat_window_title") ||
    chat.getAttribute("title") ||
    "My Agent"
  );
}

function setIfMissing(element, name, value) {
  if (!element.hasAttribute(name) || !element.getAttribute(name)) {
    const normalized =
      typeof value === "string" ? value : JSON.stringify(value);
    element.setAttribute(name, normalized);
  }
}

function applyWidgetDefaults(chat, title) {
  chat.setAttribute("window_title", title);
  chat.removeAttribute("chat_window_title");

  Object.entries(widgetDefaults).forEach(([name, value]) => {
    setIfMissing(chat, name, value);
  });
}

function extractFromSnippet(rawSnippet) {
  const doc = new DOMParser().parseFromString(rawSnippet, "text/html");
  const script = [...doc.querySelectorAll("script[src]")].find((item) =>
    item.getAttribute("src").toLowerCase().includes("langflow")
  );
  const chat = doc.querySelector("langflow-chat");
  const key = apiKey.value.trim() || chat?.getAttribute("api_key") || "";

  if (!script || !chat) {
    throw new Error(
      "Paste the full Langflow embed snippet, including the script tag and langflow-chat tag."
    );
  }

  if (!key) {
    throw new Error("Paste a Langflow API key before launching.");
  }

  const title = getTitleFromChat(chat);
  chat.setAttribute("api_key", key);
  applyWidgetDefaults(chat, title);

  return {
    scriptSrc: script.getAttribute("src"),
    host: chat.getAttribute("host_url") || "",
    flow: chat.getAttribute("flow_id") || "",
    title,
    rawChat: chat.outerHTML,
  };
}

function buildFromFields() {
  const host = normalizeHost(hostUrl.value);
  const flow = flowId.value.trim();
  const scriptSrc = scriptUrl.value.trim() || DEFAULT_SCRIPT_URL;
  const title = agentTitle.value.trim() || "My Agent";
  const key = apiKey.value.trim();

  if (!host || !flow || !scriptSrc || !key) {
    throw new Error(
      "Host URL, flow ID, widget script URL, and Langflow API key are required."
    );
  }

  const chat = document.createElement("langflow-chat");
  chat.setAttribute("host_url", host);
  chat.setAttribute("flow_id", flow);
  chat.setAttribute("api_key", key);
  applyWidgetDefaults(chat, title);

  return {
    scriptSrc,
    host,
    flow,
    title,
    rawChat: chat.outerHTML,
  };
}

/* ---- Generated full-page experience (restyled to match console) --------- */
function buildPreviewHtml(config) {
  const title = escapeAttribute(config.title || "My Agent");
  const host = escapeAttribute(config.host || "Connected");
  const flow = escapeAttribute(config.flow || "Connected");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: dark;
        --void: #090c12;
        --surface: #11151f;
        --surface-2: #161b27;
        --line: #232b3b;
        --line-2: #2e3a4f;
        --ink: #eef2fa;
        --ink-2: #b3bdd0;
        --muted: #7c8aa6;
        --faint: #586277;
        --amber: #ffb224;
        --amber-bright: #ffc44d;
        --live: #4ade80;
        --mono: "JetBrains Mono", monospace;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        font-size: 16px;
        background-color: var(--void);
        background-image:
          radial-gradient(900px 520px at 84% -6%, rgba(255,178,36,0.12), transparent 60%),
          radial-gradient(760px 540px at 4% 2%, rgba(58,84,140,0.18), transparent 58%),
          linear-gradient(180deg, #0b0f16, var(--void) 62%);
        background-attachment: fixed;
        -webkit-font-smoothing: antialiased;
      }
      .page {
        width: min(1140px, calc(100vw - 40px));
        margin: 0 auto;
        padding: clamp(24px, 4vw, 40px) 0 56px;
      }
      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: clamp(40px, 7vw, 72px);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        border: 1px solid var(--line-2);
        background: linear-gradient(150deg, #20283a, #131826);
      }
      .mark svg { width: 22px; height: 22px; }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--line-2);
        border-radius: 999px;
        background: var(--surface-2);
        color: var(--ink-2);
        padding: 8px 13px;
        font-family: var(--mono);
        font-size: 0.74rem;
        letter-spacing: 0.04em;
      }
      .pill .dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--live);
        box-shadow: 0 0 0 4px rgba(74,222,128,0.16);
      }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr);
        gap: 32px;
        align-items: center;
      }
      .eyebrow {
        margin: 0 0 14px;
        font-family: var(--mono);
        font-size: 0.74rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--amber);
      }
      h1 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: clamp(2.1rem, 1rem + 4vw, 3.4rem);
        font-weight: 600;
        line-height: 1.02;
        letter-spacing: -0.025em;
      }
      .lead {
        width: min(560px, 100%);
        margin: 20px 0 0;
        color: var(--muted);
        font-size: 1.05rem;
        line-height: 1.62;
      }
      .metrics { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
      .metric {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface-2);
        padding: 13px 16px;
        min-width: 116px;
      }
      .metric strong {
        display: block;
        font-family: var(--mono);
        font-size: 0.66rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--faint);
      }
      .metric span {
        display: block;
        margin-top: 6px;
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        color: var(--ink);
      }
      .experience {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent 110px), var(--surface);
        box-shadow: 0 30px 80px -28px rgba(0,0,0,0.8);
        padding: 22px;
      }
      .experience h2 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .experience p { margin: 9px 0 0; color: var(--muted); line-height: 1.55; font-size: 0.92rem; }
      .rows { display: grid; gap: 9px; margin-top: 18px; }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--line);
        border-radius: 11px;
        background: var(--surface-2);
        padding: 13px 14px;
      }
      .row span { color: var(--muted); font-size: 0.86rem; }
      .row strong {
        font-family: var(--mono);
        font-size: 0.76rem;
        font-weight: 500;
        letter-spacing: 0.03em;
        color: var(--live);
      }
      .row .truncate {
        max-width: 150px; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; color: var(--ink-2);
      }
      @media (max-width: 760px) {
        .nav { flex-direction: column; align-items: flex-start; margin-bottom: 36px; }
        .hero { grid-template-columns: 1fr; }
      }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
    </style>
    <script src="${escapeAttribute(config.scriptSrc)}"><\/script>
  </head>
  <body>
    <main class="page">
      <header class="nav">
        <div class="brand">
          <div class="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ffb224" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 13c0-4 2.5-8 7-9 1 3.5.5 6.5-2 9" />
              <path d="M5 13l-1 4 4-1" />
              <path d="M13 14c2 0 3.5 1.5 3.5 4-2.5 0-4-1.5-4-3.5" />
            </svg>
          </div>
          <span>Agent Workspace</span>
        </div>
        <div class="pill"><span class="dot"></span> Langflow powered</div>
      </header>

      <section class="hero">
        <div>
          <p class="eyebrow">Live agent</p>
          <h1>${title}</h1>
          <p class="lead">
            The browser-ready build of your Langflow agent. Open the chat in the
            corner and interact with it as a deployed assistant.
          </p>
          <div class="metrics" aria-label="Agent status">
            <div class="metric"><strong>Status</strong><span>Live</span></div>
            <div class="metric"><strong>Runtime</strong><span>Langflow</span></div>
            <div class="metric"><strong>Interface</strong><span>Chat</span></div>
          </div>
        </div>

        <aside class="experience" aria-label="Agent details">
          <h2>Connection</h2>
          <p>The chat widget runs the selected flow with the model configuration already set inside Langflow.</p>
          <div class="rows">
            <div class="row"><span>Host</span><span class="truncate">${host}</span></div>
            <div class="row"><span>Flow</span><span class="truncate">${flow}</span></div>
            <div class="row"><span>API access</span><strong>Authorized</strong></div>
            <div class="row"><span>Chat window</span><strong>Ready</strong></div>
          </div>
        </aside>
      </section>
    </main>
    ${config.rawChat}
  </body>
</html>`;
}

/* ---- Persistence -------------------------------------------------------- */
function saveState() {
  localStorage.setItem(
    "langflowLauncher",
    JSON.stringify({
      hostUrl: hostUrl.value,
      flowId: flowId.value,
      scriptUrl: scriptUrl.value,
      agentTitle: agentTitle.value,
    })
  );
}

/* ---- Launch / reset / open --------------------------------------------- */
function launch() {
  clearError();
  try {
    const config =
      activeMode === "snippet"
        ? extractFromSnippet(snippet.value)
        : buildFromFields();

    currentPreviewHtml = buildPreviewHtml(config);
    previewFrame.srcdoc = currentPreviewHtml;
    previewFrame.hidden = false;
    emptyPreview.hidden = true;
    openBtn.disabled = false;

    previewTitle.textContent = config.title || "Preview bay";
    previewSubhead.textContent = "The external chat page is ready to open.";
    previewChip.textContent = "Live";
    previewChip.setAttribute("data-state", "live");

    telHost.textContent = config.host || "connected";
    telFlow.textContent = config.flow || "connected";
    telState.textContent = "Live";
    telState.setAttribute("data-live", "true");

    sequence.classList.add("is-launched");
    setStatus("Live", "live");
    saveState();
  } catch (launchError) {
    showError(launchError.message);
  }
}

function clearAll() {
  snippet.value = "";
  hostUrl.value = "";
  flowId.value = "";
  scriptUrl.value = DEFAULT_SCRIPT_URL;
  agentTitle.value = "My Agent";
  apiKey.value = "";
  apiKey.type = "password";
  toggleKeyBtn.textContent = "Show";

  previewFrame.removeAttribute("srcdoc");
  previewFrame.hidden = true;
  emptyPreview.hidden = false;
  openBtn.disabled = true;

  previewTitle.textContent = "Preview bay";
  previewSubhead.textContent = "Your agent loads here, ready to open full-screen.";
  previewChip.textContent = "Standby";
  previewChip.setAttribute("data-state", "idle");

  telHost.textContent = "—";
  telFlow.textContent = "—";
  telState.textContent = "Idle";
  telState.removeAttribute("data-live");

  sequence.classList.remove("is-launched");
  setStatus("Standby", "idle");

  currentPreviewHtml = "";
  localStorage.removeItem("langflowLauncher");
  clearError();
}

function openFullPage() {
  if (!currentPreviewHtml) {
    showError("Launch an agent first.");
    return;
  }
  const previewBlob = new Blob([currentPreviewHtml], { type: "text/html" });
  window.open(URL.createObjectURL(previewBlob), "_blank", "noopener,noreferrer");
}

function toggleKeyVisibility() {
  const hidden = apiKey.type === "password";
  apiKey.type = hidden ? "text" : "password";
  toggleKeyBtn.textContent = hidden ? "Hide" : "Show";
  apiKey.focus();
}

/* ---- Events ------------------------------------------------------------- */
snippetTab.addEventListener("click", () => setMode("snippet"));
flowTab.addEventListener("click", () => setMode("flow"));
launchBtn.addEventListener("click", launch);
clearBtn.addEventListener("click", clearAll);
openBtn.addEventListener("click", openFullPage);
toggleKeyBtn.addEventListener("click", toggleKeyVisibility);