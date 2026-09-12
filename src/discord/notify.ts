import { getDb } from "../db.js";
import { getCurrentUserId } from "../context.js";

// Lazy Discord client — reused if bot.ts already logged in, otherwise create ephemeral REST sender
let restClient: any = null;
async function getRest() {
  if (restClient) return restClient;
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  const { REST } = await import("discord.js");
  restClient = new REST({ version: "10" }).setToken(token);
  return restClient;
}

export async function sendDiscordMessage(opts: {
  target: "dm" | "channel";
  channelId?: string;
  discordUserId?: string;
  message: string;
}): Promise<{ sent: boolean; target: string; id?: string }> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN not set — Discord not configured");

  // Try via bot client if available (for DM via linked user)
  if (opts.target === "dm") {
    let discordUserId = opts.discordUserId;
    if (!discordUserId) {
      const userId = getCurrentUserId();
      if (userId === "anonymous" || userId === "local") throw new Error("DM requires linked Discord account — run link.create in Open WebUI then /buddytrails-verify in Discord");
      const db = getDb();
      const link = db.prepare(`SELECT discord_user_id FROM user_discord_link WHERE openwebui_user_id = ?`).get(userId) as any;
      if (!link) throw new Error("No Discord link found — run link.create in Open WebUI then /buddytrails-verify in Discord");
      discordUserId = link.discord_user_id;
    }
    // Use REST to create DM channel + send
    const rest = await getRest();
    const dmChannel: any = await (rest as any).post(`/users/@me/channels`, { body: { recipient_id: discordUserId } });
    const channelId = dmChannel.id;
    const msg: any = await (rest as any).post(`/channels/${channelId}/messages`, { body: { content: opts.message.slice(0, 2000) } });
    return { sent: true, target: `dm:${discordUserId}`, id: msg.id };
  }

  // Channel send
  if (!opts.channelId) throw new Error("channelId required for channel target");
  const rest = await getRest();
  const msg: any = await (rest as any).post(`/channels/${opts.channelId}/messages`, { body: { content: opts.message.slice(0, 2000) } });
  return { sent: true, target: `channel:${opts.channelId}`, id: msg.id };
}
