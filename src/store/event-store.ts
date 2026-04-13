import type { AgentSummary, ExecutionSummary, ParsedSSEEvent } from "../types";

export interface RunningExecution {
  id: number;
  agent: string;
  triggerSource: string;
  startedAt: number; // Date.now()
  events: ParsedSSEEvent[];
  lastActivity: string;
  tokensTotal: number;
  costUsd: number;
  finalAnswer?: string;
}

type Listener = () => void;

export interface CompletedSnapshot {
  events: ParsedSSEEvent[];
  finalAnswer?: string;
}

export class EventStore {
  private _agents: AgentSummary[] = [];
  private _running = new Map<number, RunningExecution>();
  private _history: ExecutionSummary[] = [];
  private _completedSnapshots = new Map<number, CompletedSnapshot>();

  private agentListeners = new Set<Listener>();
  private runningListeners = new Set<Listener>();
  private historyListeners = new Set<Listener>();

  // ---- Getters ----

  get agents(): readonly AgentSummary[] {
    return this._agents;
  }

  get running(): ReadonlyMap<number, RunningExecution> {
    return this._running;
  }

  get history(): readonly ExecutionSummary[] {
    return this._history;
  }

  // ---- Subscriptions ----

  onAgentsChanged(listener: Listener): () => void {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  onRunningChanged(listener: Listener): () => void {
    this.runningListeners.add(listener);
    return () => this.runningListeners.delete(listener);
  }

  onHistoryChanged(listener: Listener): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  // ---- Mutations ----

  setAgents(agents: AgentSummary[]): void {
    this._agents = [...agents].sort((a, b) => a.name.localeCompare(b.name));
    this.notify(this.agentListeners);
  }

  setHistory(executions: ExecutionSummary[]): void {
    this._history = executions;
    this.notify(this.historyListeners);
  }

  startExecution(id: number, agent: string, triggerSource: string): void {
    this._running.set(id, {
      id,
      agent,
      triggerSource,
      startedAt: Date.now(),
      events: [],
      lastActivity: "",
      tokensTotal: 0,
      costUsd: 0,
    });
    this.notify(this.runningListeners);
  }

  pushEvent(executionId: number, event: ParsedSSEEvent): void {
    const run = this._running.get(executionId);
    if (!run) return;

    run.events.push(event);

    // Update lastActivity — handle both live format (tools/content) and
    // replayed format from DB (message field)
    const msg = event.data.content ?? event.data.message ?? "";
    if (event.type === "tool_call") {
      const name = event.data.tools?.[0]?.name ?? msg.split("(")[0] ?? "tool";
      run.lastActivity = `🔧 ${name}`;
    } else if (event.type === "tool_result") {
      run.lastActivity = `📎 ${event.data.tool_name ?? "result"}`;
    } else if (event.type === "ai" && msg) {
      run.lastActivity = `🤖 ${msg.slice(0, 60)}`;
    } else if (event.type === "final_answer" && msg) {
      run.finalAnswer = msg;
      run.lastActivity = `✅ Final answer`;
    }

    // Update stats from complete event
    if (event.type === "complete") {
      if (event.data.total_tokens != null) run.tokensTotal = event.data.total_tokens;
      if (event.data.cost_usd != null) run.costUsd = event.data.cost_usd;
    }

    this.notify(this.runningListeners);
  }

  /** Get the saved event log for a completed execution (if it was observed live). */
  getCompletedSnapshot(executionId: number): CompletedSnapshot | undefined {
    return this._completedSnapshots.get(executionId);
  }

  completeExecution(executionId: number, summary: ExecutionSummary): void {
    const running = this._running.get(executionId);
    if (running) {
      // Preserve events + final answer before deleting
      this._completedSnapshots.set(executionId, {
        events: running.events,
        finalAnswer: running.finalAnswer,
      });
    }
    this._running.delete(executionId);
    // Prepend to history (most recent first)
    this._history = [summary, ...this._history];
    this.notify(this.runningListeners);
    this.notify(this.historyListeners);
  }

  removeRunning(executionId: number): void {
    this._running.delete(executionId);
    this.notify(this.runningListeners);
  }

  // ---- Internal ----

  private notify(listeners: Set<Listener>): void {
    for (const fn of listeners) {
      fn();
    }
  }
}
