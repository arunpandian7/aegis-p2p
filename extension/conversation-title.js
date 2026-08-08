/*
 * Provider title extraction kept separate from message collection so DOM
 * changes can be covered without exercising or retaining conversation text.
 */

(() => {
  "use strict";

  const MAX_TITLE_CHARS = 240;
  const GENERIC_TITLES = new Set([
    "anthropic",
    "chat options",
    "chatgpt",
    "claude",
    "claude.ai",
    "conversation options",
    "more",
    "openai",
    "options",
    "skip to content",
    "skip to main content",
  ]);

  const TITLE_SELECTORS = {
    anthropic: [
      '[data-testid="chat-title-button"] .truncate',
      'button[data-testid="chat-title-button"] div.truncate',
      '[data-testid="chat-title-button"]',
      '[data-testid="conversation-title"]',
      '[data-testid="chat-title"]',
    ],
    // ChatGPT currently exposes similarly named accessibility elements that
    // are not the generated chat title. Its URL-bound history link is the
    // reliable, conversation-specific source and is handled below.
    openai: [],
  };

  function cleanTitle(value) {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    if (!cleaned || GENERIC_TITLES.has(cleaned.toLowerCase())) return null;
    return cleaned;
  }

  function decoded(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function conversationIdFromUrl(provider, href, baseUrl) {
    try {
      const pathname = new URL(href, baseUrl).pathname;
      const match =
        provider === "openai"
          ? pathname.match(/\/c\/([^/?#]+)/i)
          : pathname.match(/\/chat\/([^/?#]+)/i) ?? pathname.match(/\/chats\/([^/?#]+)/i);
      return match ? decoded(match[1]) : null;
    } catch {
      return null;
    }
  }

  function elementLooksActive(element) {
    if (element.getAttribute?.("aria-current") === "page") return true;
    if (element.getAttribute?.("data-state") === "active") return true;
    return Boolean(element.closest?.('[aria-current="page"], [data-state="active"]'));
  }

  function titleFromElement(element) {
    if (!element) return null;

    // Both providers put the visible title in a truncating child in at least
    // one layout. Prefer that node so adjacent menu controls cannot pollute it.
    const truncatedElement = element.querySelector?.(".truncate");
    const truncated = cleanTitle(truncatedElement?.innerText) ?? cleanTitle(truncatedElement?.textContent);
    if (truncated) return truncated;

    const candidates = [
      element.value,
      element.innerText,
      element.textContent,
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label"),
    ];
    for (const candidate of candidates) {
      const title = cleanTitle(candidate);
      if (title) return title;
    }
    return null;
  }

  function titleFromProviderElement(document, provider) {
    for (const selector of TITLE_SELECTORS[provider] ?? []) {
      for (const element of document.querySelectorAll(selector)) {
        const title = titleFromElement(element);
        if (title) return title;
      }
    }
    return null;
  }

  function titleFromConversationLink(document, provider, conversationId, currentUrl) {
    const selectors =
      provider === "openai"
        ? ['nav[aria-label="Chat history"] a[href]', '[data-testid^="history-item-"] a[href]', "a[href]"]
        : ["a[href]"];
    const links = [];
    for (const selector of selectors) {
      for (const link of document.querySelectorAll(selector)) {
        if (!links.includes(link)) links.push(link);
      }
    }

    const matchingLinks = links.filter((link) => {
      const href = link.getAttribute?.("href") ?? link.href;
      return conversationIdFromUrl(provider, href, currentUrl) === conversationId;
    });

    // Desktop/mobile sidebars can render duplicate links. Inspect every exact
    // match, with the active one first, instead of stopping on an empty link.
    const orderedLinks = [
      ...matchingLinks.filter(elementLooksActive),
      ...matchingLinks.filter((link) => !elementLooksActive(link)),
    ];
    for (const link of orderedLinks) {
      const title = titleFromElement(link);
      if (title) return title;
    }
    return null;
  }

  function titleFromDocument(document) {
    let title = typeof document.title === "string" ? document.title : "";
    const product = "(?:ChatGPT|Claude(?:\\.ai)?|OpenAI|Anthropic)";
    const separator = "(?:[|\\-–—·])";
    title = title.replace(new RegExp(`^\\s*${product}\\s*${separator}\\s*`, "i"), "");
    title = title.replace(new RegExp(`\\s*${separator}\\s*${product}\\s*$`, "i"), "");
    return cleanTitle(title);
  }

  function extract({ document, provider, conversationId, currentUrl }) {
    if (provider === "openai") {
      return (
        titleFromConversationLink(document, provider, conversationId, currentUrl) ??
        titleFromDocument(document)
      );
    }

    return (
      titleFromProviderElement(document, provider) ??
      titleFromConversationLink(document, provider, conversationId, currentUrl) ??
      titleFromDocument(document)
    );
  }

  globalThis.AegisConversationTitle = Object.freeze({ extract });
})();
