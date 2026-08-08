"use client";

import { useState } from "react";

/**
 * "Why was this expensive?" — the beat a dashboard structurally cannot do.
 *
 * Streams so the answer arrives visibly rather than after a spinner.
 */
export function Explainer({
  identifier,
  cached,
}: {
  identifier: string;
  cached: string | null;
}) {
  const [text, setText] = useState(cached ?? "");
  const [state, setState] = useState<"idle" | "running" | "done">(cached ? "done" : "idle");

  async function run() {
    setState("running");
    setText("");
    try {
      const res = await fetch(`/api/explain/${identifier}`);
      if (!res.body) {
        setText(await res.text());
        setState("done");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
      setState("done");
    } catch (err) {
      setText(`Could not reach the explainer: ${(err as Error).message}`);
      setState("done");
    }
  }

  return (
    <section className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--color-edge)] px-4 py-3">
        <div>
          <h2 className="font-medium">Why did this cost what it did?</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Every figure below is computed from the trace. Claude writes the sentences, not the
            numbers.
          </p>
        </div>
        <button
          onClick={run}
          disabled={state === "running"}
          className="shrink-0 rounded border border-[var(--color-edge)] px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
        >
          {state === "running" ? "Reading trace…" : text ? "Re-run" : "Explain"}
        </button>
      </div>

      <div className="px-4 py-4">
        {text ? (
          <p className="text-sm leading-relaxed text-[var(--color-text)]">
            {text}
            {state === "running" ? (
              <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[var(--color-text)]" />
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            Not generated yet.
          </p>
        )}
      </div>
    </section>
  );
}
