"use strict";

const form = document.querySelector("#settings-form");
const urlInput = document.querySelector("#aegis-url");
const keyInput = document.querySelector("#ingest-key");
const machineInput = document.querySelector("#machine-name");
const enabledInput = document.querySelector("#enabled");
const testButton = document.querySelector("#test-connection");
const status = document.querySelector("#status");

function showStatus(message, kind = "neutral") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function normalizedUrl() {
  const value = new URL(urlInput.value.trim());
  if (value.protocol !== "http:" && value.protocol !== "https:") throw new Error("Use an http or https URL");
  return value.href.replace(/\/$/, "");
}

function originPattern(urlValue) {
  const value = new URL(urlValue);
  return `${value.protocol}//${value.hostname}/*`;
}

async function save(requestServerAccess = false) {
  const aegisUrl = normalizedUrl();
  const ingestKey = keyInput.value.trim();
  const enabled = enabledInput.checked;
  if (enabled || requestServerAccess) {
    const granted = await chrome.permissions.request({ origins: [originPattern(aegisUrl)] });
    if (!granted) throw new Error("Aegis server access was not granted");
  }

  const previous = await chrome.storage.local.get({ aegisUrl: "", ingestKey: "" });
  const serverChanged = previous.aegisUrl !== aegisUrl || previous.ingestKey !== ingestKey;
  await chrome.storage.local.set({
    aegisUrl,
    ingestKey,
    machineName: machineInput.value.trim() || "browser-extension",
    enabled,
    ...(serverChanged ? { conversationStates: {} } : {}),
  });
  await chrome.runtime.sendMessage({ type: "AEGIS_CONFIG_UPDATED" }).catch(() => undefined);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("Saving…");
  try {
    await save();
    showStatus(enabledInput.checked ? "Saved. Open chats will sync automatically." : "Saved. Capture is paused.", "ok");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

testButton.addEventListener("click", async () => {
  showStatus("Connecting…");
  try {
    await save(true);
    const result = await chrome.runtime.sendMessage({ type: "AEGIS_TEST_CONNECTION" });
    if (result?.error) throw new Error(result.error);
    showStatus("Connected. The ingest key is valid.", "ok");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

async function restore() {
  const values = await chrome.storage.local.get({
    aegisUrl: "http://localhost:3000",
    ingestKey: "",
    machineName: "browser-extension",
    enabled: false,
  });
  urlInput.value = values.aegisUrl;
  keyInput.value = values.ingestKey;
  machineInput.value = values.machineName;
  enabledInput.checked = values.enabled;
}

void restore();
