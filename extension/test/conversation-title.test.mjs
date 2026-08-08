import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function adapter() {
  const context = { URL };
  const source = await readFile(new URL("../conversation-title.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  return context.AegisConversationTitle;
}

function element({ text = "", visibleText = null, href = null, attributes = {}, truncated = null, active = false } = {}) {
  const attrs = { ...attributes };
  if (href !== null) attrs.href = href;
  return {
    textContent: text,
    innerText: visibleText ?? text,
    href,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    querySelector(selector) {
      return selector === ".truncate" && truncated !== null
        ? { innerText: truncated, textContent: truncated }
        : null;
    },
    closest() {
      return active ? this : null;
    },
  };
}

function fixture({ title = "", links = [], selectors = {} } = {}) {
  return {
    title,
    querySelectorAll(selector) {
      if (selector === "a[href]") return links;
      return selectors[selector] ?? [];
    },
  };
}

test("reads Claude's semantic chat title control", async () => {
  const { extract } = await adapter();
  const document = fixture({
    title: "Claude",
    selectors: {
      '[data-testid="chat-title-button"] .truncate': [element({ text: "Fix extension title" })],
    },
  });

  assert.equal(
    extract({
      document,
      provider: "anthropic",
      conversationId: "claude-123",
      currentUrl: "https://claude.ai/chat/claude-123",
    }),
    "Fix extension title",
  );
});

test("reads the exact ChatGPT conversation link and skips empty duplicates", async () => {
  const { extract } = await adapter();
  const document = fixture({
    title: "ChatGPT",
    links: [
      element({ href: "/c/conversation-123-extra", text: "Wrong conversation" }),
      element({ href: "/c/conversation-123", text: "" }),
      element({ href: "/g/g-p-demo/c/conversation-123", truncated: "Launch plan", active: true }),
    ],
  });

  assert.equal(
    extract({
      document,
      provider: "openai",
      conversationId: "conversation-123",
      currentUrl: "https://chatgpt.com/g/g-p-demo/c/conversation-123",
    }),
    "Launch plan",
  );
});

test("rejects ChatGPT's Skip to content accessibility element", async () => {
  const { extract } = await adapter();
  const currentLink = element({
    href: "/c/conversation-123",
    visibleText: "Actual summarized title",
    active: true,
  });
  const document = fixture({
    title: "ChatGPT",
    selectors: {
      '[data-testid="conversation-title"]': [element({ text: "Skip to content" })],
      'nav[aria-label="Chat history"] a[href]': [currentLink],
    },
    links: [currentLink],
  });

  assert.equal(
    extract({
      document,
      provider: "openai",
      conversationId: "conversation-123",
      currentUrl: "https://chatgpt.com/c/conversation-123",
    }),
    "Actual summarized title",
  );
});

test("returns no title when ChatGPT exposes only Skip to content", async () => {
  const { extract } = await adapter();
  const document = fixture({
    title: "Skip to content",
    links: [element({ href: "/c/conversation-123", text: "Skip to content" })],
  });

  assert.equal(
    extract({
      document,
      provider: "openai",
      conversationId: "conversation-123",
      currentUrl: "https://chatgpt.com/c/conversation-123",
    }),
    null,
  );
});

test("prefers conversation-owned metadata over a stale browser tab title", async () => {
  const { extract } = await adapter();
  const document = fixture({
    title: "Previous conversation - ChatGPT",
    links: [element({ href: "/c/current-123", text: "Current conversation" })],
  });

  assert.equal(
    extract({
      document,
      provider: "openai",
      conversationId: "current-123",
      currentUrl: "https://chatgpt.com/c/current-123",
    }),
    "Current conversation",
  );
});

test("cleans provider branding from the document-title fallback", async () => {
  const { extract } = await adapter();
  const document = fixture({ title: "Release checklist | Claude.ai" });

  assert.equal(
    extract({
      document,
      provider: "anthropic",
      conversationId: "claude-123",
      currentUrl: "https://claude.ai/chat/claude-123",
    }),
    "Release checklist",
  );
});

test("does not guess a title from unrelated page content", async () => {
  const { extract } = await adapter();
  const document = fixture({
    title: "Claude",
    selectors: { h1: [element({ text: "Unrelated heading" })] },
  });

  assert.equal(
    extract({
      document,
      provider: "anthropic",
      conversationId: "claude-123",
      currentUrl: "https://claude.ai/chat/claude-123",
    }),
    null,
  );
});
