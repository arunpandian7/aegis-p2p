"use strict";

const MAX_CONVERSATION_STATES = 500;

// Keep the ingest key out of content-script reach. The page collector only
// receives the boolean enabled state through AEGIS_STATUS below.
if (chrome.storage.local.setAccessLevel) {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") void chrome.runtime.openOptionsPage();
});

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : null;
}

function clampCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function normalizeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Aegis URL must use http or https");
  }
  return url.href.replace(/\/$/, "");
}

function earlierIso(first, second) {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first) <= Date.parse(second) ? first : second;
}

function trimStates(states) {
  const entries = Object.entries(states);
  if (entries.length <= MAX_CONVERSATION_STATES) return states;
  entries.sort(([, a], [, b]) => Date.parse(b.syncedAt) - Date.parse(a.syncedAt));
  return Object.fromEntries(entries.slice(0, MAX_CONVERSATION_STATES));
}

async function config() {
  const values = await chrome.storage.local.get({
    enabled: false,
    aegisUrl: "http://localhost:3000",
    ingestKey: "",
    machineName: "browser-extension",
  });
  return {
    enabled: Boolean(values.enabled),
    aegisUrl: normalizeUrl(values.aegisUrl),
    ingestKey: String(values.ingestKey || "").trim(),
    machineName: String(values.machineName || "browser-extension").trim(),
  };
}

async function postSessions(currentConfig, sessions) {
  const response = await fetch(`${currentConfig.aegisUrl}/api/ingest/sessions`, {
    method: "POST",
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${currentConfig.ingestKey}`,
    },
    body: JSON.stringify({ machine: currentConfig.machineName, sessions }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 240);
    throw new Error(`Aegis returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

async function recordFailure(snapshot, error) {
  const latestCapture = {
    status: "error",
    provider: snapshot?.provider ?? null,
    projectName: snapshot?.projectName ?? null,
    conversationTitle: snapshot?.conversationTitle ?? null,
    messageCount: snapshot?.messageCount ?? 0,
    error: error instanceof Error ? error.message : String(error),
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ latestCapture });
}

async function handleCapture(rawSnapshot) {
  const snapshot = rawSnapshot && typeof rawSnapshot === "object" ? rawSnapshot : null;
  if (!snapshot || !["anthropic", "openai"].includes(snapshot.provider)) {
    throw new Error("Unsupported capture payload");
  }

  const conversationId = clean(snapshot.conversationId, 300);
  const contentHash = clean(snapshot.contentHash, 128);
  if (!conversationId || !contentHash) throw new Error("Capture is missing a conversation id or digest");

  const currentConfig = await config();
  if (!currentConfig.enabled) return { skipped: "disabled" };
  if (!currentConfig.ingestKey) throw new Error("Add an Aegis ingest key in extension settings");

  const stateKey = `${snapshot.provider}:${conversationId}`;
  const stored = await chrome.storage.local.get({ conversationStates: {} });
  const states = stored.conversationStates ?? {};
  const previous = states[stateKey];
  if (previous?.contentHash === contentHash) return { skipped: "unchanged" };

  const capturedAt = !Number.isNaN(Date.parse(snapshot.capturedAt))
    ? snapshot.capturedAt
    : new Date().toISOString();
  const firstSeenAt = earlierIso(
    !Number.isNaN(Date.parse(snapshot.startedAt)) ? snapshot.startedAt : null,
    previous?.firstSeenAt ?? capturedAt,
  );
  const provider = snapshot.provider;
  const surface = provider === "anthropic" ? "claude_web" : "chatgpt_web";

  const session = {
    sessionId: `web:${provider}:${conversationId}`,
    provider,
    surface,
    externalProjectId: clean(snapshot.projectId, 500),
    externalProjectName: clean(snapshot.projectName, 300),
    externalConversationId: conversationId,
    externalConversationUrl: clean(snapshot.conversationUrl, 2_000),
    conversationTitle: clean(snapshot.conversationTitle, 500),
    captureMethod: "extension",
    usageBasis: "estimated",
    contentHash,
    startedAt: firstSeenAt,
    endedAt: capturedAt,
    costBasis: "pool",
    isPrivate: true,
    messageCount: clampCount(snapshot.messageCount),
    events: [
      {
        seq: 0,
        ts: capturedAt,
        model: `${provider}-web-unreported`,
        inputTokens: clampCount(snapshot.estimatedInputTokens),
        outputTokens: clampCount(snapshot.estimatedOutputTokens),
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        iterations: 1,
        toolCalls: [],
      },
    ],
  };

  await postSessions(currentConfig, [session]);

  const syncedAt = new Date().toISOString();
  states[stateKey] = { contentHash, firstSeenAt, syncedAt };
  const latestCapture = {
    status: "synced",
    provider,
    projectName: session.externalProjectName,
    conversationTitle: session.conversationTitle,
    messageCount: session.messageCount,
    updatedAt: syncedAt,
  };
  await chrome.storage.local.set({ conversationStates: trimStates(states), latestCapture });
  return { synced: true };
}

async function testConnection() {
  const currentConfig = await config();
  if (!currentConfig.ingestKey) throw new Error("Enter an ingest key first");
  await postSessions(currentConfig, []);
  return { ok: true };
}

async function captureOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "AEGIS_CAPTURE_NOW" })),
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AEGIS_STATUS") {
    chrome.storage.local
      .get({ enabled: false })
      .then(({ enabled }) => sendResponse({ enabled: Boolean(enabled) }))
      .catch(() => sendResponse({ enabled: false }));
    return true;
  }

  if (message?.type === "AEGIS_CAPTURE") {
    handleCapture(message.snapshot)
      .then(sendResponse)
      .catch(async (error) => {
        await recordFailure(message.snapshot, error);
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (message?.type === "AEGIS_TEST_CONNECTION") {
    testConnection()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "AEGIS_CONFIG_UPDATED") {
    captureOpenTabs()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return false;
});
