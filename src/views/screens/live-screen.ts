import { setIcon } from "obsidian";
import type { PanelContext } from "../panel-view";
import { createCard, createEmojiBox, createStopPill, createEmptyState } from "../../ui/cards";
import { formatDuration, formatTokens, formatCost } from "../../ui/format";

export function renderLiveScreen(container: HTMLElement, ctx: PanelContext): void {
  if (ctx.store.running.size === 0) {
    createEmptyState(container, {
      icon: "activity",
      title: "No running executions",
      desc: "Runs you start appear here in real time. Open the Agents tab and press ▶ to run one.",
    });
    return;
  }

  const list = container.createDiv({ cls: "agentmd-card-list" });

  for (const [, exec] of ctx.store.running) {
    const waiting = exec.state === "waiting";
    const card = createCard(list, { running: !waiting, waiting });
    card.addEventListener("click", () => ctx.nav.push({ kind: "execution", id: exec.id }));

    // Name row
    const nameRow = card.createDiv({ cls: "agentmd-card-row" });
    const agentIcon = ctx.store.agents.find((a) => a.name === exec.agent)?.icon || "🤖";
    createEmojiBox(nameRow, agentIcon, waiting ? "waiting" : "running");
    nameRow.createSpan({ cls: "agentmd-card-name", text: exec.agent });
    nameRow.createSpan({ cls: "agentmd-card-id", text: `#${exec.id}` });
    if (!waiting) createStopPill(nameRow, () => ctx.actions.onCancelExecution(exec.id));

    // Activity line: the pending question while waiting, else the live activity
    const activity = waiting
      ? `${exec.pending?.message ?? "Waiting for your response"} — tap to respond`
      : exec.lastActivity;
    if (activity) card.createDiv({ cls: "agentmd-activity", text: activity });

    // Meta line
    const meta = card.createDiv({ cls: "agentmd-meta-line" });
    const status = meta.createSpan({
      cls: waiting
        ? "agentmd-meta-status agentmd-status-waiting"
        : "agentmd-meta-status agentmd-status-running",
    });
    if (waiting) {
      const ic = status.createSpan();
      setIcon(ic, "pause");
      status.createSpan({ text: " Waiting" });
    } else {
      status.setText("● Running");
    }

    const elapsedMs = (waiting && exec.pausedAt != null ? exec.pausedAt : Date.now()) - exec.startedAt;
    const elapsed = Math.round(elapsedMs / 1000);
    meta.createSpan({ text: formatDuration(elapsed) });
    if (!waiting && exec.tokensTotal > 0) meta.createSpan({ text: formatTokens(exec.tokensTotal) });
    if (!waiting && exec.costUsd > 0) meta.createSpan({ text: formatCost(exec.costUsd) });
  }
}
