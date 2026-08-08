import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function harness() {
  const storage = {
    enabled: true,
    aegisUrl: "http://localhost:3000",
    ingestKey: "aegis_mk_test",
    machineName: "test-browser",
  };
  const requests = [];
  let messageListener;

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      async openOptionsPage() {},
    },
    storage: {
      local: {
        async setAccessLevel() {},
        async get(defaults) {
          if (typeof defaults === "string") return { [defaults]: storage[defaults] };
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    tabs: {
      async query() {
        return [];
      },
      async sendMessage() {},
    },
  };

  const fetch = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { accepted: 1 };
      },
      async text() {
        return "";
      },
    };
  };

  const source = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { chrome, fetch, URL, Date, Number, Object, String, Error, Promise, console });

  async function dispatch(message) {
    return new Promise((resolve, reject) => {
      try {
        const asyncResponse = messageListener(message, {}, resolve);
        if (!asyncResponse) reject(new Error("listener did not keep the response channel open"));
      } catch (error) {
        reject(error);
      }
    });
  }

  return { dispatch, requests, storage };
}

const snapshot = {
  provider: "openai",
  conversationId: "conversation-123",
  conversationUrl: "https://chatgpt.com/g/g-p-demo/c/conversation-123",
  conversationTitle: "Demo launch plan",
  projectId: "g-p-demo",
  projectName: "Hackathon",
  messageCount: 6,
  estimatedInputTokens: 120,
  estimatedOutputTokens: 340,
  contentHash: "a".repeat(64),
  messages: [{ role: "user", text: "secret prompt that must be discarded" }],
  startedAt: "2026-08-08T08:00:00.000Z",
  capturedAt: "2026-08-08T08:10:00.000Z",
};

test("turns a browser snapshot into a private, estimated project session", async () => {
  const app = await harness();
  const result = await app.dispatch({ type: "AEGIS_CAPTURE", snapshot });

  assert.equal(result.synced, true);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, "http://localhost:3000/api/ingest/sessions");

  const payload = JSON.parse(app.requests[0].init.body);
  const session = payload.sessions[0];
  assert.equal(session.sessionId, "web:openai:conversation-123");
  assert.equal(session.externalProjectId, "g-p-demo");
  assert.equal(session.externalProjectName, "Hackathon");
  assert.equal(session.externalConversationId, "conversation-123");
  assert.equal(session.conversationTitle, "Demo launch plan");
  assert.equal(session.surface, "chatgpt_web");
  assert.equal(session.captureMethod, "extension");
  assert.equal(session.usageBasis, "estimated");
  assert.equal(session.costBasis, "pool");
  assert.equal(session.isPrivate, true);
  assert.equal(session.messageCount, 6);
  assert.equal(session.events[0].inputTokens, 120);
  assert.equal(session.events[0].outputTokens, 340);
  assert.equal(JSON.stringify(payload).includes("secret prompt"), false);
  assert.equal(app.storage.latestCapture.conversationTitle, "Demo launch plan");
});

test("does not upload an unchanged conversation twice", async () => {
  const app = await harness();
  await app.dispatch({ type: "AEGIS_CAPTURE", snapshot });
  const result = await app.dispatch({ type: "AEGIS_CAPTURE", snapshot });

  assert.equal(result.skipped, "unchanged");
  assert.equal(app.requests.length, 1);
});

test("uploads a renamed conversation even when its messages are unchanged", async () => {
  const app = await harness();
  await app.dispatch({ type: "AEGIS_CAPTURE", snapshot });
  const result = await app.dispatch({
    type: "AEGIS_CAPTURE",
    snapshot: {
      ...snapshot,
      conversationTitle: "Renamed launch plan",
      contentHash: "b".repeat(64),
    },
  });

  assert.equal(result.synced, true);
  assert.equal(app.requests.length, 2);
  const payload = JSON.parse(app.requests[1].init.body);
  assert.equal(payload.sessions[0].conversationTitle, "Renamed launch plan");
});
