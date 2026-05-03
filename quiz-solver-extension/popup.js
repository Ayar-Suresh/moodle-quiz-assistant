// popup.js — QuizSnipe Popup Logic

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = "show " + type;
  setTimeout(() => { toast.className = ""; }, 2500);
}

async function loadApiKey() {
  const result = await chrome.storage.sync.get(["groqApiKey"]);
  const keyStatus = document.getElementById("key-status");
  const keyStatusText = document.getElementById("key-status-text");
  const dot = document.getElementById("status-dot");

  if (result.groqApiKey) {
    keyStatus.className = "key-status has-key";
    const masked = result.groqApiKey.slice(0, 6) + "••••••••" + result.groqApiKey.slice(-4);
    keyStatusText.textContent = `Key saved: ${masked}`;
    dot.classList.add("active");
    document.getElementById("api-key-input").placeholder = "Update key…";
  } else {
    keyStatus.className = "key-status no-key";
    keyStatusText.textContent = "No API key saved";
    dot.classList.remove("active");
  }
}

async function saveApiKey() {
  const input = document.getElementById("api-key-input");
  const key = input.value.trim();

  if (!key) {
    showToast("⚠️ Enter an API key first", "error");
    return;
  }

  if (!key.startsWith("gsk_")) {
    showToast("⚠️ Groq keys start with gsk_", "error");
    return;
  }

  await chrome.storage.sync.set({ groqApiKey: key });
  input.value = "";
  loadApiKey();
  showToast("✓ API key saved!", "success");
}

async function getPageStatus() {
  const tab = await getCurrentTab();
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
    if (response) {
      document.getElementById("q-count").textContent = response.count ?? "—";
      document.getElementById("toggle-panel-btn").textContent =
        response.visible ? "🎯 Hide Panel" : "🎯 Open Panel";
    }
  } catch {
    document.getElementById("q-count").textContent = "—";
  }
}

async function togglePanel() {
  const tab = await getCurrentTab();
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
    if (response) {
      document.getElementById("q-count").textContent = response.count;
      document.getElementById("toggle-panel-btn").innerHTML =
        response.visible ? "🎯 Hide Panel" : "🎯 Open Panel";
    }
  } catch {
    showToast("⚠️ Reload the page and try again", "error");
  }
}

async function scanPage() {
  const tab = await getCurrentTab();
  if (!tab?.id) return;

  const btn = document.getElementById("scan-btn");
  btn.textContent = "⟳";
  btn.disabled = true;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
    await getPageStatus();
    showToast("✓ Page scanned!", "success");
  } catch {
    showToast("⚠️ Can't scan this page", "error");
  } finally {
    btn.textContent = "Scan ↺";
    btn.disabled = false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await loadApiKey();
  await getPageStatus();

  document.getElementById("save-btn").addEventListener("click", saveApiKey);
  document.getElementById("api-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveApiKey();
  });

  document.getElementById("toggle-panel-btn").addEventListener("click", togglePanel);
  document.getElementById("scan-btn").addEventListener("click", scanPage);
});
