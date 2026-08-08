"use strict";

const state = document.querySelector("#capture-state");
const latest = document.querySelector("#latest");

document.querySelector("#open-settings").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

function providerName(provider) {
  return provider === "anthropic" ? "Claude" : provider === "openai" ? "ChatGPT" : "Conversation";
}

async function render() {
  const values = await chrome.storage.local.get({ enabled: false, latestCapture: null });
  state.textContent = values.enabled ? "Automatic" : "Paused";
  state.dataset.enabled = String(values.enabled);

  const item = values.latestCapture;
  if (!item) return;
  if (item.status === "error") {
    latest.textContent = `Sync error: ${item.error}`;
    latest.dataset.kind = "error";
    return;
  }

  const project = item.projectName || "Unfiled chats";
  const title = item.conversationTitle || "Untitled conversation";
  latest.textContent = `${providerName(item.provider)} · ${project}\n${title}\n${item.messageCount} messages`;
}

void render();
