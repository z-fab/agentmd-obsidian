import type { PanelContext } from "../panel-view";
import type { ExecutionSummary } from "../../types";
import { createCard, createEmojiBox } from "../../ui/cards";
import { resolveAgentEmoji } from "../../ui/agent-emoji";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "../../ui/format";

type StatusFilter = "all" | "success" | "failed" | "aborted";
type PeriodFilter = "today" | "7d" | "30d" | "all";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "success", label: "✓" },
  { value: "failed", label: "✗" },
  { value: "aborted", label: "⚠" },
];

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "Tudo" },
];

export class HistoryScreen {
  private statusFilter: StatusFilter = "all";
  private agentFilter: string = "all";
  private periodFilter: PeriodFilter = "today";
  private executions: ExecutionSummary[] = [];
  private offset = 0;
  private readonly pageSize = 30;
  private loading = false;
  private loaded = false;
  private loadSeq = 0;
  private container: HTMLElement | null = null;

  constructor(private ctx: PanelContext) {}

  render(container: HTMLElement): void {
    this.container = container;
    if (!this.loaded && !this.loading) {
      void this.load();
    }
    this.paint();
  }

  private async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.paint();
    try {
      const params: { status?: string; agent?: string; limit: number; offset: number } = {
        limit: this.pageSize,
        offset: this.offset,
      };
      if (this.statusFilter !== "all") params.status = this.statusFilter;
      if (this.agentFilter !== "all") params.agent = this.agentFilter;
      const results = await this.ctx.actions.getExecutions(params);
      if (seq !== this.loadSeq) return;
      if (this.offset === 0) {
        this.executions = results;
      } else {
        this.executions = [...this.executions, ...results];
      }
    } catch {
      if (seq !== this.loadSeq) return;
      // keep going on error
    }
    this.loaded = true;
    this.loading = false;
    this.paint();
  }

  private applyFilter(): void {
    this.offset = 0;
    void this.load();
  }

  private paint(): void {
    if (!this.container) return;
    const container = this.container;
    container.empty();

    this.renderFilters(container);

    if (this.loading) {
      container.createDiv({ cls: "agentmd-empty", text: "Carregando…" });
      return;
    }

    const filtered = this.filterByPeriod(this.executions);

    if (filtered.length === 0) {
      container.createDiv({ cls: "agentmd-empty", text: "Nenhuma execução encontrada." });
      return;
    }

    const list = container.createDiv({ cls: "agentmd-card-list" });
    for (const exec of filtered) {
      this.renderRow(list, exec);
    }

    if (this.executions.length >= this.offset + this.pageSize) {
      const loadMore = container.createDiv({ cls: "agentmd-load-more" });
      loadMore.createEl("button", { cls: "agentmd-btn", text: "Carregar mais" }).addEventListener("click", () => {
        this.offset += this.pageSize;
        void this.load();
      });
    }
  }

  private renderFilters(container: HTMLElement): void {
    const filterArea = container.createDiv({ cls: "agentmd-filter-area" });

    // Agente (first): dropdown
    const agentRow = filterArea.createDiv({ cls: "agentmd-filter-group" });
    agentRow.createSpan({ cls: "agentmd-filter-label", text: "Agente" });
    const agentSelect = agentRow.createEl("select", { cls: "agentmd-filter-select" });
    const allOpt = agentSelect.createEl("option", { text: "Todos os agentes", value: "all" });
    if (this.agentFilter === "all") allOpt.selected = true;
    for (const agent of this.ctx.store.agents) {
      const opt = agentSelect.createEl("option", { text: agent.name, value: agent.name });
      if (this.agentFilter === agent.name) opt.selected = true;
    }
    agentSelect.addEventListener("change", () => {
      this.agentFilter = agentSelect.value;
      this.applyFilter();
    });

    // Status: segmented control
    const statusRow = filterArea.createDiv({ cls: "agentmd-filter-group" });
    statusRow.createSpan({ cls: "agentmd-filter-label", text: "Status" });
    const statusSeg = statusRow.createDiv({ cls: "agentmd-segmented" });
    for (const opt of STATUS_OPTIONS) {
      const btn = statusSeg.createEl("button", {
        cls: `agentmd-seg-btn ${this.statusFilter === opt.value ? "active" : ""}`,
        text: opt.label,
      });
      btn.addEventListener("click", () => {
        this.statusFilter = opt.value;
        this.applyFilter();
      });
    }

    // Período: segmented control
    const periodRow = filterArea.createDiv({ cls: "agentmd-filter-group" });
    periodRow.createSpan({ cls: "agentmd-filter-label", text: "Período" });
    const periodSeg = periodRow.createDiv({ cls: "agentmd-segmented" });
    for (const opt of PERIOD_OPTIONS) {
      const btn = periodSeg.createEl("button", {
        cls: `agentmd-seg-btn ${this.periodFilter === opt.value ? "active" : ""}`,
        text: opt.label,
      });
      btn.addEventListener("click", () => {
        this.periodFilter = opt.value;
        this.applyFilter();
      });
    }
  }

  private renderRow(list: HTMLElement, exec: ExecutionSummary): void {
    const isSuccess = exec.status === "success";
    const isFailed = exec.status === "failed" || exec.status === "error";
    const state: "success" | "error" | "aborted" = isSuccess ? "success" : isFailed ? "error" : "aborted";

    const card = createCard(list);
    card.addEventListener("click", () => this.ctx.nav.push({ kind: "execution", id: exec.id }));

    // Name row: emoji box + agent name + #id + time
    const row = card.createDiv({ cls: "agentmd-card-row" });
    const agentIcon = this.ctx.store.agents.find((a) => a.name === exec.agent_id)?.icon;
    createEmojiBox(row, resolveAgentEmoji(exec.agent_id, agentIcon), state);
    row.createSpan({ cls: "agentmd-card-name", text: exec.agent_id });
    row.createSpan({ cls: "agentmd-card-id", text: `#${exec.id}` });
    const time = row.createSpan({ cls: "exec-row-time", text: formatRelativeTime(exec.started_at) });
    time.style.marginLeft = "auto";

    // Meta line: status text + duration · tokens · cost (+ error)
    const meta = card.createDiv({ cls: "agentmd-meta-line" });
    if (isSuccess) {
      meta.createSpan({ cls: "agentmd-meta-status agentmd-status-success", text: "✓ Concluído" });
    } else if (isFailed) {
      meta.createSpan({ cls: "agentmd-meta-status agentmd-status-failed", text: "✗ Erro" });
    } else {
      meta.createSpan({ cls: "agentmd-meta-status agentmd-status-aborted", text: "⚠ Abortado" });
    }
    meta.createSpan({ text: formatDuration(exec.duration_ms != null ? exec.duration_ms / 1000 : undefined) });
    meta.createSpan({ text: formatTokens(exec.total_tokens) });
    meta.createSpan({ text: formatCost(exec.cost_usd) });
    if (exec.error) {
      const errorText = exec.error.length > 30 ? exec.error.slice(0, 30) + "…" : exec.error;
      meta.createSpan({ cls: "exec-row-error-inline", text: errorText });
    }
  }

  private filterByPeriod(executions: ExecutionSummary[]): ExecutionSummary[] {
    if (this.periodFilter === "all") return executions;
    const now = Date.now();
    const cutoff =
      this.periodFilter === "today" ? now - 24 * 3600_000 :
      this.periodFilter === "7d" ? now - 7 * 24 * 3600_000 :
      now - 30 * 24 * 3600_000;
    return executions.filter((e) => new Date(e.started_at).getTime() >= cutoff);
  }
}
