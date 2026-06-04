import type { PanelContext } from "../panel-view";
import { createCard, createEmojiBox, createStopPill } from "../../ui/cards";
import { formatDuration, formatTokens, formatCost } from "../../ui/format";

export function renderLiveScreen(container: HTMLElement, ctx: PanelContext): void {
  if (ctx.store.running.size === 0) {
    container.createDiv({ cls: "agentmd-empty", text: "No running executions." });
    return;
  }

  const list = container.createDiv({ cls: "agentmd-card-list" });

  for (const [, exec] of ctx.store.running) {
    const card = createCard(list, { running: true });
    card.addEventListener("click", () => ctx.nav.push({ kind: "execution", id: exec.id }));

    // Name row
    const nameRow = card.createDiv({ cls: "agentmd-card-row" });
    const agentIcon = ctx.store.agents.find((a) => a.name === exec.agent)?.icon || "🤖";
    createEmojiBox(nameRow, agentIcon, "running");
    nameRow.createSpan({ cls: "agentmd-card-name", text: exec.agent });
    nameRow.createSpan({ cls: "agentmd-card-id", text: `#${exec.id}` });
    createStopPill(nameRow, () => ctx.actions.onCancelExecution(exec.id));

    // Activity line
    if (exec.lastActivity) {
      card.createDiv({ cls: "agentmd-activity", text: exec.lastActivity });
    }

    // Meta line
    const meta = card.createDiv({ cls: "agentmd-meta-line" });
    meta.createSpan({ cls: "agentmd-meta-status agentmd-status-running", text: "● Running" });

    const elapsed = Math.round((Date.now() - exec.startedAt) / 1000);
    meta.createSpan({ text: formatDuration(elapsed) });

    if (exec.tokensTotal > 0) {
      meta.createSpan({ text: formatTokens(exec.tokensTotal) });
    }
    if (exec.costUsd > 0) {
      meta.createSpan({ text: formatCost(exec.costUsd) });
    }
  }
}
