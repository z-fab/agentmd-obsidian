import { Menu, setIcon } from "obsidian";
import type { PanelContext } from "../panel-view";
import type { AgentSummary } from "../../types";
import { createCard, createEmojiBox, createChip, createTriggerChip, createRunningPill, createWaitingPill, createEmptyState } from "../../ui/cards";

export function renderAgentsScreen(container: HTMLElement, ctx: PanelContext): void {
  if (ctx.store.agents.length === 0) {
    createEmptyState(container, {
      icon: "bot",
      title: "No agents yet",
      desc: "Add an agent .md file to your agents directory, then press Refresh below.",
    });
    return;
  }

  const list = container.createDiv({ cls: "agentmd-card-list" });

  for (const agent of ctx.store.agents) {
    // Split this agent's active executions into running vs waiting.
    const runningIds: number[] = [];
    const waitingIds: number[] = [];
    for (const [id, r] of ctx.store.running) {
      if (r.agent !== agent.name) continue;
      if (r.state === "waiting") waitingIds.push(id);
      else runningIds.push(id);
    }
    const isRunning = runningIds.length > 0;

    // Agents cards have NO border. Box pulses blue only while running.
    const card = createCard(list);
    card.addEventListener("click", () => ctx.actions.onRunAgent(agent.name, false));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      buildAgentMenu(ctx, agent, runningIds, waitingIds).showAtMouseEvent(e);
    });

    // Name row: emoji box + name + status pills + kebab
    const nameRow = card.createDiv({ cls: "agentmd-card-row" });
    createEmojiBox(nameRow, agent.icon || "🤖", isRunning ? "running" : undefined);
    nameRow.createSpan({ cls: "agentmd-card-name", text: agent.name });

    if (isRunning) {
      createRunningPill(nameRow, String(runningIds.length), () => ctx.nav.push({ kind: "execution", id: runningIds[0] }));
    }
    if (waitingIds.length > 0) {
      createWaitingPill(nameRow, String(waitingIds.length), () => ctx.nav.push({ kind: "execution", id: waitingIds[0] }));
    }

    const kebab = nameRow.createSpan({ cls: "agentmd-kebab" });
    setIcon(kebab, "more-vertical");
    kebab.setAttr("aria-label", "Options");
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      buildAgentMenu(ctx, agent, runningIds, waitingIds).showAtMouseEvent(e as MouseEvent);
    });

    if (agent.description) {
      card.createDiv({ cls: "agentmd-card-desc", text: agent.description });
    }

    // Footer: trigger (with icon) + model name only (no provider)
    const footer = card.createDiv({ cls: "agentmd-card-footer" });
    createTriggerChip(footer, agent.trigger_type);
    if (agent.model_name) createChip(footer, agent.model_name, "model");
  }
}

/** Build the per-agent options menu (kebab / right-click). */
function buildAgentMenu(ctx: PanelContext, agent: AgentSummary, runningIds: number[], waitingIds: number[]): Menu {
  const menu = new Menu();

  if (waitingIds.length > 0) {
    menu.addItem((i) =>
      i.setTitle(`Respond… (${waitingIds.length} pending)`).setIcon("circle-pause").onClick(() =>
        ctx.nav.push({ kind: "execution", id: waitingIds[0] }),
      ),
    );
    menu.addSeparator();
  }

  menu.addItem((i) => i.setTitle("Run").setIcon("play").onClick(() => ctx.actions.onRunAgent(agent.name, false)));
  menu.addItem((i) => {
    i.setTitle("Run with current file").setIcon("file-play");
    if (ctx.actions.getCurrentFilePath()) i.onClick(() => ctx.actions.onRunAgent(agent.name, true));
    else i.setDisabled(true);
  });

  menu.addSeparator();

  if (runningIds.length > 0) {
    menu.addItem((i) => i.setTitle("Stop running").setIcon("square").onClick(() => ctx.actions.onCancelExecution(runningIds[0])));
  }
  menu.addItem((i) => i.setTitle("Open details").setIcon("info").onClick(() => ctx.nav.push({ kind: "agent", name: agent.name })));
  menu.addItem((i) => i.setTitle("Open source file").setIcon("file-text").onClick(() => ctx.actions.onOpenSourceFile(agent.name)));
  menu.addItem((i) => i.setTitle("All executions").setIcon("history").onClick(() => ctx.nav.openHistoryForAgent(agent.name)));

  return menu;
}
