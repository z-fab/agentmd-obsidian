import type { PanelContext } from "../panel-view";
import { createCard, createEmojiBox, createChip, createStopPill } from "../../ui/cards";

export function renderAgentsScreen(container: HTMLElement, ctx: PanelContext): void {
  if (ctx.store.agents.length === 0) {
    container.createDiv({ cls: "agentmd-empty", text: "No agents found. Is the backend running?" });
    return;
  }

  const list = container.createDiv({ cls: "agentmd-card-list" });

  for (const agent of ctx.store.agents) {
    // Determine running state
    let runningId: number | null = null;
    for (const [id, r] of ctx.store.running) {
      if (r.agent === agent.name) { runningId = id; break; }
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
