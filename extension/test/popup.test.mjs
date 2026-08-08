import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("shows the synced conversation title in the extension popup", async () => {
  const elements = new Map(
    ["#capture-state", "#latest", "#open-settings"].map((selector) => [
      selector,
      {
        textContent: "",
        dataset: {},
        addEventListener() {},
      },
    ]),
  );
  const document = {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };
  const chrome = {
    runtime: { async openOptionsPage() {} },
    storage: {
      local: {
        async get() {
          return {
            enabled: true,
            latestCapture: {
              status: "synced",
              provider: "openai",
              projectName: "Hackathon",
              conversationTitle: "Demo launch plan",
              messageCount: 6,
            },
          };
        },
      },
    },
  };

  const source = await readFile(new URL("../popup.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { chrome, document, String });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("#capture-state").textContent, "Automatic");
  assert.match(elements.get("#latest").textContent, /Demo launch plan/);
});
