import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("stops background capture when an extension reload invalidates the content-script context", async () => {
  let scheduledCapture = null;
  let intervalCleared = false;
  let observerDisconnected = false;
  let sendCount = 0;

  class MutationObserver {
    constructor() {}
    observe() {}
    disconnect() {
      observerDisconnected = true;
    }
  }

  const chrome = {
    runtime: {
      id: "test-extension",
      onMessage: { addListener() {} },
      lastError: null,
      sendMessage(_message, callback) {
        sendCount++;
        this.id = undefined;
        this.lastError = { message: "Extension context invalidated." };
        callback(undefined);
        this.lastError = null;
      },
    },
  };
  const document = {
    documentElement: {},
    querySelectorAll() {
      return [];
    },
  };
  const location = {
    hostname: "chatgpt.com",
    pathname: "/c/conversation-123",
    href: "https://chatgpt.com/c/conversation-123",
  };
  const source = await readFile(new URL("../content.js", import.meta.url), "utf8");

  vm.runInNewContext(source, {
    chrome,
    clearInterval() {
      intervalCleared = true;
    },
    clearTimeout() {},
    console,
    crypto,
    Date,
    document,
    globalThis: { AegisConversationTitle: { extract: () => null } },
    location,
    MutationObserver,
    setInterval() {
      return 2;
    },
    setTimeout(callback) {
      scheduledCapture = callback;
      return 1;
    },
    addEventListener() {},
  });

  assert.equal(typeof scheduledCapture, "function");
  scheduledCapture();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sendCount, 1);
  assert.equal(intervalCleared, true);
  assert.equal(observerDisconnected, true);
});
