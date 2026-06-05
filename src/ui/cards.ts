import { setIcon } from "obsidian";
import type { PendingRequest } from "../types";
import { buildRespondBody } from "../views/hilt";

/** Render a friendly empty state: a Lucide icon, a title, and an optional description. */
export function createEmptyState(
  parent: HTMLElement,
  opts: { icon: string; title: string; desc?: string },
): HTMLElement {
  const wrap = parent.createDiv({ cls: "agentmd-empty-state" });
  const icon = wrap.createDiv({ cls: "agentmd-empty-icon" });
  setIcon(icon, opts.icon);
  wrap.createDiv({ cls: "agentmd-empty-title", text: opts.title });
  if (opts.desc) wrap.createDiv({ cls: "agentmd-empty-desc", text: opts.desc });
  return wrap;
}

/** Create the elevated card container. Add `running` to apply the spinning border. */
export function createCard(parent: HTMLElement, opts?: { running?: boolean; waiting?: boolean }): HTMLElement {
  const card = parent.createDiv({ cls: "agentmd-card" });
  if (opts?.running) card.addClass("is-running");
  if (opts?.waiting) card.addClass("is-waiting");
  return card;
}

/**
 * Create the emoji-box. `state` colors the box:
 * - "running" → pulsing blue, "waiting" → pulsing orange, "success"/"error"/"aborted" → status tint, undefined → neutral.
 */
export function createEmojiBox(
  parent: HTMLElement,
  emoji: string,
  state?: "running" | "waiting" | "success" | "error" | "aborted",
): HTMLElement {
  const box = parent.createSpan({ cls: "agentmd-emoji-box", text: emoji });
  if (state) box.addClass(`is-${state}`);
  return box;
}

export function createChip(parent: HTMLElement, text: string, variant?: string): HTMLElement {
  const chip = parent.createSpan({ cls: "agentmd-chip", text });
  if (variant) chip.addClass(variant);
  return chip;
}

/**
 * Render the "Action needed" block for a waiting execution and wire its controls.
 * `onRespond(body)` receives the `response` object to POST.
 */
export function createActionNeeded(
  parent: HTMLElement,
  pending: PendingRequest,
  onRespond: (body: Record<string, unknown>) => void,
): HTMLElement {
  const block = parent.createDiv({ cls: "exec-action-needed" });

  const label = block.createDiv({ cls: "an-label" });
  const labelIcon = label.createSpan();
  setIcon(labelIcon, "circle-pause");
  label.createSpan({ text: " Action needed" });

  block.createDiv({ cls: "an-q", text: pending.message });

  if (pending.tool_name) {
    const args = pending.tool_args ? ` · ${JSON.stringify(pending.tool_args)}` : "";
    block.createDiv({ cls: "an-tool", text: `${pending.tool_name}${args}` });
  }

  const acts = block.createDiv({ cls: "an-acts" });

  let sent = false;
  const submit = (body: Record<string, unknown>) => {
    if (sent) return;
    sent = true;
    // disable all buttons + inputs in the block, show a sending hint
    block.querySelectorAll("button, input").forEach((el) => ((el as HTMLButtonElement | HTMLInputElement).disabled = true));
    acts.createSpan({ cls: "an-sending", text: "Sending…" });
    onRespond(body);
  };

  if (pending.kind === "confirm") {
    let reasonInput: HTMLInputElement | null = null;
    const approve = acts.createEl("button", { cls: "agentmd-btn primary", text: "✓ Approve" });
    approve.addEventListener("click", () => submit(buildRespondBody("confirm", { approved: true })));
    const deny = acts.createEl("button", { cls: "agentmd-btn danger", text: "✕ Deny" });
    deny.addEventListener("click", () =>
      submit(buildRespondBody("confirm", { approved: false, reason: reasonInput?.value || undefined })),
    );
    const addReason = acts.createEl("button", { cls: "agentmd-btn ghost", text: "＋ reason" });
    addReason.addEventListener("click", () => {
      if (reasonInput) return;
      reasonInput = block.createEl("input", { cls: "agentmd-input" }) as HTMLInputElement;
      reasonInput.placeholder = "Reason (optional) — sent with Deny";
      reasonInput.focus();
    });
  } else if (pending.kind === "input") {
    const input = acts.createEl("input", { cls: "agentmd-input" }) as HTMLInputElement;
    input.placeholder = "Type your answer…";
    const send = acts.createEl("button", { cls: "agentmd-btn primary", text: "Send" });
    const doSubmit = () => submit(buildRespondBody("input", { text: input.value }));
    send.addEventListener("click", doSubmit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSubmit(); });
  } else {
    // choice
    const options = pending.options ?? [];
    const selected = new Set<string>();
    if (!pending.multi) {
      for (const opt of options) {
        const chip = acts.createSpan({ cls: "agentmd-chip", text: opt });
        chip.addEventListener("click", () => submit(buildRespondBody("choice", { selected: [opt] })));
      }
    } else {
      for (const opt of options) {
        const chip = acts.createSpan({ cls: "agentmd-chip", text: opt });
        chip.addEventListener("click", () => {
          if (selected.has(opt)) { selected.delete(opt); chip.removeClass("sel"); }
          else { selected.add(opt); chip.addClass("sel"); }
        });
      }
      const send = acts.createEl("button", { cls: "agentmd-btn primary", text: "Send" });
      send.addEventListener("click", () => {
        if (selected.size === 0) return;
        submit(buildRespondBody("choice", { selected: [...selected] }));
      });
    }
  }

  return block;
}

/** Stop pill button ("■ Stop"), hidden until card hover via CSS. */
export function createStopPill(parent: HTMLElement, onClick: (e: MouseEvent) => void): HTMLElement {
  const btn = parent.createEl("button", { cls: "agentmd-stop-pill", text: "■ Stop" });
  btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
  return btn;
}
