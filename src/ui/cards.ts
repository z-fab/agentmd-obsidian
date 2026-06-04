/** Create the elevated card container. Add `running` to apply the spinning border. */
export function createCard(parent: HTMLElement, opts?: { running?: boolean }): HTMLElement {
  const card = parent.createDiv({ cls: "agentmd-card" });
  if (opts?.running) card.addClass("is-running");
  return card;
}

/**
 * Create the emoji-box. `state` colors the box:
 * - "running" → pulsing blue, "success"/"error"/"aborted" → status tint, undefined → neutral.
 */
export function createEmojiBox(
  parent: HTMLElement,
  emoji: string,
  state?: "running" | "success" | "error" | "aborted",
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

/** Stop pill button ("■ Parar"), hidden until card hover via CSS. */
export function createStopPill(parent: HTMLElement, onClick: (e: MouseEvent) => void): HTMLElement {
  const btn = parent.createEl("button", { cls: "agentmd-stop-pill", text: "■ Parar" });
  btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
  return btn;
}
