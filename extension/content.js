/*
 * Runs on claude.ai and chatgpt.com after one-time extension consent.
 * Message text is read only long enough to calculate counts and a SHA-256
 * digest. It is never included in the payload sent to Aegis.
 */

(() => {
  "use strict";

  const PROVIDER = location.hostname === "claude.ai" ? "anthropic" : "openai";
  const MIN_CAPTURE_INTERVAL_MS = 10_000;
  const PERIODIC_CAPTURE_MS = 30_000;
  const MAX_MESSAGE_CHARS = 200_000;

  let captureTimer = null;
  let lastCaptureStartedAt = 0;

  function cleanText(value, maxLength = 500) {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned ? cleaned.slice(0, maxLength) : null;
  }

  function pathMatch(pattern) {
    const match = location.pathname.match(pattern);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function conversationId() {
    return PROVIDER === "openai"
      ? pathMatch(/\/c\/([^/?#]+)/i)
      : pathMatch(/\/chat\/([^/?#]+)/i) ?? pathMatch(/\/chats\/([^/?#]+)/i);
  }

  function projectIdFromPath() {
    if (PROVIDER === "openai") {
      const projectSegment = location.pathname
        .split("/")
        .map((part) => decodeURIComponent(part))
        .find((part) => part.startsWith("g-p-"));
      return projectSegment ?? pathMatch(/\/projects?\/([^/?#]+)/i);
    }
    return pathMatch(/\/projects?\/([^/?#]+)/i);
  }

  function elementLooksActive(element) {
    if (element.getAttribute("aria-current") === "page") return true;
    if (element.getAttribute("data-state") === "active") return true;
    return Boolean(element.closest('[aria-current="page"], [data-state="active"]'));
  }

  function projectFromActiveLink() {
    const links = [...document.querySelectorAll("a[href]")];
    for (const link of links) {
      if (!elementLooksActive(link)) continue;
      let url;
      try {
        url = new URL(link.href, location.href);
      } catch {
        continue;
      }

      const match =
        PROVIDER === "openai"
          ? url.pathname.match(/\/(g-p-[^/?#]+)/i) ?? url.pathname.match(/\/projects?\/([^/?#]+)/i)
          : url.pathname.match(/\/projects?\/([^/?#]+)/i);
      if (match) {
        return {
          id: decodeURIComponent(match[1]),
          name: cleanText(link.textContent, 160),
        };
      }
    }
    return { id: null, name: null };
  }

  function projectName(projectId) {
    const explicitSelectors = [
      '[data-testid="project-title"]',
      '[data-testid="project-name"]',
      '[data-testid*="project"][aria-current="page"]',
    ];
    for (const selector of explicitSelectors) {
      const value = cleanText(document.querySelector(selector)?.textContent, 160);
      if (value) return value;
    }

    if (projectId) {
      const matches = [...document.querySelectorAll("a[href]")]
        .filter((link) => {
          try {
            return decodeURIComponent(new URL(link.href, location.href).pathname).includes(projectId);
          } catch {
            return false;
          }
        })
        .map((link) => cleanText(link.textContent, 160))
        .filter(Boolean)
        .sort((a, b) => a.length - b.length);
      if (matches[0]) return matches[0];
    }

    return null;
  }

  function conversationTitle(id) {
    const suffixes = [/\s*[|\-–—]\s*ChatGPT\s*$/i, /\s*[|\-–—]\s*Claude\s*$/i];
    let title = document.title;
    for (const suffix of suffixes) title = title.replace(suffix, "");
    title = cleanText(title, 240);
    if (title && !/^(chatgpt|claude)$/i.test(title)) return title;

    const currentLink = [...document.querySelectorAll("a[href]")].find((link) => {
      try {
        return decodeURIComponent(new URL(link.href, location.href).pathname).includes(id);
      } catch {
        return false;
      }
    });
    return cleanText(currentLink?.textContent, 240);
  }

  function conversationUrl() {
    const url = new URL(location.href);
    // Query strings are unnecessary for reopening a chat and can contain
    // transient provider state, so only persist the canonical path.
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function addCandidates(target, selector, role) {
    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement)) continue;
      const text = cleanText(element.innerText || element.textContent, MAX_MESSAGE_CHARS);
      if (!text) continue;
      target.push({ element, role, text });
    }
  }

  function collectMessages() {
    const candidates = [];

    if (PROVIDER === "openai") {
      for (const element of document.querySelectorAll("[data-message-author-role]")) {
        if (!(element instanceof HTMLElement)) continue;
        const role = element.getAttribute("data-message-author-role");
        if (role !== "user" && role !== "assistant") continue;
        const text = cleanText(element.innerText || element.textContent, MAX_MESSAGE_CHARS);
        if (text) candidates.push({ element, role, text });
      }
    } else {
      addCandidates(candidates, '[data-testid="user-message"]', "user");
      addCandidates(candidates, '[data-testid="assistant-message"]', "assistant");
      addCandidates(candidates, '[data-message-author-role="user"]', "user");
      addCandidates(candidates, '[data-message-author-role="assistant"]', "assistant");
      addCandidates(candidates, ".font-user-message", "user");
      addCandidates(candidates, ".font-claude-response", "assistant");
      addCandidates(candidates, '[data-is-streaming="true"]', "assistant");
    }

    // Provider UIs occasionally expose both a message wrapper and its inner
    // content node. Keep one candidate for nested duplicates, then restore DOM order.
    const deduped = [];
    for (const candidate of candidates) {
      const duplicate = deduped.some(
        (existing) =>
          existing.role === candidate.role &&
          (existing.element === candidate.element ||
            existing.element.contains(candidate.element) ||
            candidate.element.contains(existing.element)),
      );
      if (!duplicate) deduped.push(candidate);
    }

    deduped.sort((a, b) => {
      if (a.element === b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return deduped.map(({ element, role, text }) => {
      const datetime = element.querySelector("time[datetime]")?.getAttribute("datetime");
      return { role, text, datetime: datetime && !Number.isNaN(Date.parse(datetime)) ? datetime : null };
    });
  }

  function estimatedTokens(messages, role) {
    const characters = messages
      .filter((message) => message.role === role)
      .reduce((total, message) => total + message.text.length, 0);
    return Math.ceil(characters / 4);
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function snapshot() {
    const id = conversationId();
    if (!id) return null;

    const messages = collectMessages();
    if (messages.length === 0) return null;

    const pathProjectId = projectIdFromPath();
    const activeProject = pathProjectId ? { id: pathProjectId, name: null } : projectFromActiveLink();
    const projectId = activeProject.id;
    const name = activeProject.name ?? projectName(projectId);
    const title = conversationTitle(id);
    const datetimes = messages.map((message) => message.datetime).filter(Boolean).sort();
    const capturedAt = new Date().toISOString();
    // Include placement metadata in the digest so moving a conversation into a
    // project (or renaming it) resyncs even when no message text changed.
    const normalized = JSON.stringify({
      projectId,
      projectName: name,
      conversationTitle: title,
      messages: messages.map((message) => [message.role, message.text]),
    });

    return {
      provider: PROVIDER,
      conversationId: id,
      conversationUrl: conversationUrl(),
      conversationTitle: title,
      projectId,
      projectName: name,
      messageCount: messages.length,
      estimatedInputTokens: estimatedTokens(messages, "user"),
      estimatedOutputTokens: estimatedTokens(messages, "assistant"),
      contentHash: await sha256(normalized),
      startedAt: datetimes[0] ?? null,
      capturedAt,
    };
  }

  async function capture() {
    captureTimer = null;
    lastCaptureStartedAt = Date.now();
    const status = await chrome.runtime.sendMessage({ type: "AEGIS_STATUS" }).catch(() => null);
    if (!status?.enabled) return;

    const data = await snapshot();
    if (!data) return;
    await chrome.runtime.sendMessage({ type: "AEGIS_CAPTURE", snapshot: data }).catch(() => undefined);
  }

  function scheduleCapture(delay = 1_500) {
    const elapsed = Date.now() - lastCaptureStartedAt;
    const wait = Math.max(delay, MIN_CAPTURE_INTERVAL_MS - elapsed);
    if (captureTimer !== null) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => void capture(), wait);
  }

  const observer = new MutationObserver(() => scheduleCapture());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  addEventListener("popstate", () => scheduleCapture(0));
  addEventListener("hashchange", () => scheduleCapture(0));
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "AEGIS_CAPTURE_NOW") scheduleCapture(0);
  });

  setInterval(() => scheduleCapture(0), PERIODIC_CAPTURE_MS);
  scheduleCapture(0);
})();
