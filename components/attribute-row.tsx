"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Suggestion = { id: string; identifier: string; title: string } | null;

export function AttributeRow({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "thinking" | "ready" | "saving">("idle");
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const [rationale, setRationale] = useState("");

  async function post(action: string, workUnitId?: string) {
    const res = await fetch("/api/attribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, sessionId, workUnitId }),
    });
    return res.json();
  }

  async function suggest() {
    setState("thinking");
    const json = await post("suggest");
    setSuggestion(json.suggestion ?? null);
    setRationale(json.rationale ?? "");
    setState("ready");
  }

  async function confirm() {
    if (!suggestion) return;
    setState("saving");
    await post("confirm", suggestion.id);
    router.refresh();
  }

  async function markPrivate() {
    setState("saving");
    await post("private");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "idle" ? (
        <button
          onClick={suggest}
          className="rounded border border-[var(--color-edge)] px-2.5 py-1 text-xs hover:bg-white/5"
        >
          Suggest issue
        </button>
      ) : null}

      {state === "thinking" ? (
        <span className="text-xs text-[var(--color-muted)]">Reading the trace…</span>
      ) : null}

      {state === "ready" || state === "saving" ? (
        <div className="flex flex-wrap items-center gap-2">
          {suggestion ? (
            <>
              <span className="text-xs">
                <span className="tabular text-[var(--color-dim)]">{suggestion.identifier}</span>{" "}
                {suggestion.title}
              </span>
              <button
                onClick={confirm}
                disabled={state === "saving"}
                className="rounded border border-[var(--color-good)]/40 px-2.5 py-1 text-xs text-[var(--color-good)] hover:bg-[var(--color-good)]/10 disabled:opacity-50"
              >
                Confirm
              </button>
            </>
          ) : (
            <span className="text-xs text-[var(--color-muted)]">No confident match.</span>
          )}
        </div>
      ) : null}

      <button
        onClick={markPrivate}
        disabled={state === "saving"}
        className="rounded border border-[var(--color-edge)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-white/5 disabled:opacity-50"
      >
        Mark personal
      </button>

      {rationale && state !== "idle" ? (
        <p className="w-full text-xs text-[var(--color-muted)]">{rationale}</p>
      ) : null}
    </div>
  );
}
