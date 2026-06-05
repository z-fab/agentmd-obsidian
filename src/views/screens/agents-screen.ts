import { setIcon } from "obsidian";
import type { PanelContext } from "../panel-view";
import { createCard, createEmojiBox, createChip, createStopPill, createEmptyState } from "../../ui/cards";

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
    // Determine running state
    const waitingIds: number[] = [];
    let runningId: number | null = null;
    for (const [id, r] of ctx.store.running) {
      if (r.agent !== agent.name) continue;
      if (r.state === "waiting") waitingIds.push(id);
      else if (runningId === null) runningId = id;
    }
    const isRunning = runningId !== null;

    const card = createCard(list, { running: isRunning });
    card.addEventListener("click", () => ctx.nav.push({ kind: "agent", name: agent.name }));

    // Name row: emoji box + agent name
    const nameRow = card.createDiv({ cls: "agentmd-card-row" });
    createEmojiBox(nameRow, agent.icon || "🤖", isRunning ? "running" : undefined);
    nameRow.createSpan({ cls: "agentmd-card-name", text: agent.name });

    // Description
    if (agent.description) {
      card.createDiv({ cls: "agentmd-card-desc", text: agent.description });
    }

    // Footer row
    const footer = card.createDiv({ cls: "agentmd-card-footer" });

    if (waitingIds.length > 0) {
      const chip = footer.createSpan({ cls: "agentmd-chip waiting" });
      chip.style.cursor = "pointer";
      const ic = chip.createSpan();
      setIcon(ic, "circle-pause");
      chip.createSpan({ text: ` ${waitingIds.length}` });
      chip.setAttr("aria-label", `${waitingIds.length} pending response(s)`);
      chip.addEventListener("click", (e) => { e.stopPropagation(); ctx.nav.push({ kind: "execution", id: waitingIds[0] }); });
    }
    if (isRunning) {
      createChip(footer, "● Running #" + runningId, "running");
      createStopPill(footer, () => ctx.actions.onCancelExecution(runningId!));
    } else {
      // Trigger chip
      const tt = agent.trigger_type ?? "manual";
      if (tt === "manual" || tt === "none") {
        createChip(footer, "Manual");
      } else if (tt === "schedule") {
        createChip(footer, "⏱ Scheduled", "scheduled");
      } else if (tt === "watch") {
        createChip(footer, "👁 Watch", "watch");
      } else {
        createChip(footer, tt);
      }

      // Model chip
      if (agent.model_provider || agent.model_name) {
        createChip(footer, `${agent.model_provider ?? "?"} · ${agent.model_name ?? "default"}`);
      }

      // Run buttons
      const actions = footer.createDiv({ cls: "agentmd-actions" });

      const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶" });
      runBtn.title = "Run without arguments";
      runBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.actions.onRunAgent(agent.name, false);
      });

      const currentFile = ctx.actions.getCurrentFilePath();
      const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄" });
      if (currentFile) {
        const parts = currentFile.split("/");
        runFileBtn.title = `Run with ${parts[parts.length - 1]}`;
      } else {
        runFileBtn.title = "Open a note first";
        runFileBtn.disabled = true;
      }
      runFileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.actions.onRunAgent(agent.name, true);
      });
    }
  }
}
