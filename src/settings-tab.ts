import { App, PluginSettingTab, Setting } from "obsidian";
import type AgentmdPlugin from "../main";
import type { AgentmdSettings } from "./settings";

export class AgentmdSettingTab extends PluginSettingTab {
  private plugin: AgentmdPlugin;

  constructor(app: App, plugin: AgentmdPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AgentMD Settings" });

    new Setting(containerEl)
      .setName("Socket path")
      .setDesc("Absolute path to the agentmd Unix domain socket.")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/agentmd.sock")
          .setValue(this.plugin.settings.socketPath)
          .onChange(async (value) => {
            this.plugin.settings.socketPath = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Agents directory")
      .setDesc("Absolute path to the directory containing agent .md files. Used for 'Open source file'.")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/agents")
          .setValue(this.plugin.settings.agentsDir)
          .onChange(async (value) => {
            this.plugin.settings.agentsDir = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-open execution on run")
      .setDesc("Open the execution detail tab automatically when you start a run.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenOnRun)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenOnRun = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Notifications on completion")
      .setDesc("When to show a Notice after an execution finishes.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "All runs")
          .addOption("failures", "Failures only")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.notifications)
          .onChange(async (value) => {
            this.plugin.settings.notifications = value as AgentmdSettings["notifications"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Health poll interval")
      .setDesc("Seconds between health checks when idle (10–120).")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(String(this.plugin.settings.pollIntervalMs / 1000))
          .onChange(async (value) => {
            const seconds = Math.max(10, Math.min(120, parseInt(value) || 15));
            this.plugin.settings.pollIntervalMs = seconds * 1000;
            await this.plugin.saveSettings();
          }),
      );
  }
}
