# agentmd-obsidian

An Obsidian plugin that turns Obsidian into the primary interface for
[agentmd](https://github.com/z-fab/agentmd). Connects to the agentmd HTTP
backend over a Unix domain socket to list agents, run them against the
currently-open note, and stream execution events live inside Obsidian.

Status: pre-alpha. See `docs/superpowers/specs/` for the design.

## Local development install

The plugin is not yet published. To test it against a real Obsidian vault:

1. Build the plugin:

   ```bash
   npm install
   npm run build
   ```

2. Copy the build artifacts into your vault's plugins directory. Replace
   `<VAULT>` with the absolute path to your Obsidian vault:

   ```bash
   VAULT=<VAULT>
   PLUGIN_ID=agentmd-obsidian
   mkdir -p "$VAULT/.obsidian/plugins/$PLUGIN_ID"
   cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/$PLUGIN_ID/"
   ```

3. Enable the plugin in Obsidian: Settings → Community plugins → toggle
   "agentmd" on. You may need to restart Obsidian.

4. Start the agentmd backend in your terminal:

   ```bash
   agentmd start -d
   ```

5. The Obsidian status bar (bottom right) shows `● agentmd · online`.
   Stop the backend (`agentmd stop`) and watch it flip to
   `● agentmd · offline` within ~45 seconds (three failed polls).
