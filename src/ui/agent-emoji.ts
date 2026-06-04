/** Curated, visually distinct emojis for the deterministic fallback. */
export const EMOJI_PALETTE = [
  "📅","😄","📥","📊","🧹","🔔","📝","🔎","🗂️","📌","💡","⚙️","🚀","🧠","📈","📰",
  "🛰️","🧩","🔧","📦","🗒️","🪄","🎯","🧪","🔐","🌐","📮","🧭","⏰","🗞️","🪙","🔖",
  "📤","🧮","🛎️","📚","🧰","🪛","🎲","🧵","🗳️","📡","🧯","🔋","🪪","🧾","🗺️","🎛️",
] as const;

/** Stable string hash (FNV-1a style). */
function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Resolve the emoji for an agent: explicit icon wins; otherwise a stable
 * name-derived palette entry (same name → same emoji, always).
 */
export function resolveAgentEmoji(name: string, icon?: string | null): string {
  if (icon && icon.trim().length > 0) return icon;
  return EMOJI_PALETTE[hashName(name) % EMOJI_PALETTE.length];
}
