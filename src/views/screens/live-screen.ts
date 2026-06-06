import type { PanelContext } from "../panel-view";
import { createCard, createEmojiBox, createStopPill, createRunningPill, createWaitingPill, createEmptyState } from "../../ui/cards";
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

    // Name row: box + name + #id + status pill (with timer) + stop (hover)
    const nameRow = card.createDiv({ cls: "agentmd-card-row" });
    const agentIcon = ctx.store.agents.find((a) => a.name === exec.agent)?.icon || "🤖";
    createEmojiBox(nameRow, agentIcon, waiting ? "waiting" : "running");
    nameRow.createSpan({ cls: "agentmd-card-name", text: exec.agent });
    nameRow.createSpan({ cls: "agentmd-card-id", text: `#${exec.id}` });

    // Frozen elapsed while waiting; live elapsed while running.
    const elapsedMs = (waiting && exec.pausedAt != null ? exec.pausedAt : Date.now()) - exec.startedAt;
    const elapsed = formatDuration(Math.round(elapsedMs / 1000));
    if (waiting) createWaitingPill(nameRow, elapsed);
    else createRunningPill(nameRow, elapsed);

    if (!waiting) createStopPill(nameRow, () => ctx.actions.onCancelExecution(exec.id));

    // Activity line: the pending question while waiting, else the live activity
    const activity = waiting
      ? `${exec.pending?.message ?? "Waiting for your response"} — tap to respond`
      : exec.lastActivity;
    if (activity) card.createDiv({ cls: "agentmd-activity", text: activity });

    // Meta line: token/cost stats only (status now lives in the pill)
    if (!waiting && (exec.tokensTotal > 0 || exec.costUsd > 0)) {
      const meta = card.createDiv({ cls: "agentmd-meta-line" });
      if (exec.tokensTotal > 0) meta.createSpan({ text: formatTokens(exec.tokensTotal) });
      if (exec.costUsd > 0) meta.createSpan({ text: formatCost(exec.costUsd) });
    }
  }
}
