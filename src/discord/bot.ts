import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { tools } from "../tools.js";
import { getDb } from "../db.js";
import { runWithUser } from "../context.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN not set — bot not starting");
  process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function withGuildOnly(b: any) {
  return b.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild);
}
const commands = [
  withGuildOnly(new SlashCommandBuilder().setName("buddytrails-verify").setDescription("Verify Open WebUI link code (6-digit, 10 min)").addStringOption(o => o.setName("code").setDescription("6-digit code from Open WebUI link.create").setRequired(true))),
].map(c => c.toJSON());

client.once(Events.ClientReady, async () => {
  console.error(`Discord bot ready as ${client.user?.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationCommands(client.user!.id), { body: commands });
    console.error(`Registered global commands`);
  } catch (e) { console.error("Failed to register commands", e); }
  // Hourly DM notifications for 3★ due-soon per linked user
  setInterval(async () => {
    try {
      const db = getDb();
      const links = db.prepare(`SELECT openwebui_user_id, discord_user_id FROM user_discord_link`).all() as any[];
      if (links.length === 0) return;
      for (const link of links) {
        try {
          const dueSoon = tools.find(t => t.name === "task.due_soon")!;
          const res = await runWithUser(link.openwebui_user_id, () => dueSoon.handler({ within: "24h" })) as any;
          const urgent = (res.tasks || []).filter((t: any) => t.priority === 3);
          if (urgent.length === 0) continue;
          const msg = `⏰ ${urgent.length} 3★ task(s) due soon:\n` + urgent.map((t: any) => `- ${t.title} (due ${t.deadline})`).join("\n");
          const user = await client.users.fetch(link.discord_user_id);
          await user.send(msg);
        } catch (e) { console.error(`Scheduler DM failed for ${link.openwebui_user_id}`, e); }
      }
    } catch (e) { console.error("Scheduler error", e); }
  }, 60 * 60 * 1000);

  // Daily push at 09:00 Asia/Bangkok — brief.daily + schedule to linked users
  const DAILY_HOUR = parseInt(process.env.DAILY_PUSH_HOUR ?? "9", 10);
  const DAILY_TZ_OFFSET = 7 * 60; // Asia/Bangkok UTC+7 in minutes
  function msUntilNextDaily(): number {
    const now = new Date();
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const bkkMin = (utcMin + DAILY_TZ_OFFSET) % 1440;
    const targetMin = DAILY_HOUR * 60;
    let diffMin = targetMin - bkkMin;
    if (diffMin <= 0) diffMin += 1440;
    const sec = now.getUTCSeconds();
    const ms = now.getUTCMilliseconds();
    return diffMin * 60 * 1000 - sec * 1000 - ms;
  }
  async function sendDailyPush() {
    try {
      const db = getDb();
      const links = db.prepare(`SELECT openwebui_user_id, discord_user_id FROM user_discord_link`).all() as any[];
      if (links.length === 0) return;
      for (const link of links) {
        try {
          const brief = tools.find(t => t.name === "brief.daily")!;
          const sched = tools.find(t => t.name === "task.get_today_schedule")!;
          const b = await runWithUser(link.openwebui_user_id, () => brief.handler({})) as any;
          const s = await runWithUser(link.openwebui_user_id, () => sched.handler({})) as any;
          const tasks = b.tasks ?? [];
          const blocks: any[] = s.blocks ?? [];
          if (tasks.length === 0 && blocks.length === 0 && !s.activeBlock) continue;
          let msg = `☀️ **Daily Brief — ${b.date}**\n`;
          if (s.activeBlock) msg += `📌 ${s.activeBlock.label} (${s.activeBlock.start_date}–${s.activeBlock.end_date})${s.warning ? ` — ${s.warning}` : ""}\n`;
          else if (s.warning) msg += `⚠️ ${s.warning}\n`;
          if (blocks.length > 0) {
            msg += `\n**Schedule (${s.workingWindow.start}–${s.workingWindow.end}):**\n`;
            for (const bl of blocks) msg += `• ${bl.start}–${bl.end} ${bl.title} ${"★".repeat(bl.priority)}\n`;
            if (s.overflow) msg += `⚠️ Overflow by ${s.total_with_breaks - s.window_minutes} min\n`;
          } else if (tasks.length > 0) {
            msg += `\n**Tasks today:**\n`;
            for (const t of tasks) msg += `• ${t.title} ${"★".repeat(t.priority)}${t.deadline ? ` (due ${t.deadline})` : ""}\n`;
          } else {
            msg += `\nNo tasks today. Enjoy your day!`;
          }
          if (b.topIdeas?.length) msg += `\n💡 Ideas: ${b.topIdeas.map((i: any) => i.text.slice(0, 40)).join(" | ")}`;
          const user = await client.users.fetch(link.discord_user_id);
          await user.send(msg);
        } catch (e) { console.error(`Daily push failed for ${link.openwebui_user_id}`, e); }
      }
    } catch (e) { console.error("Daily push error", e); }
  }
  function scheduleDailyPush() {
    const delay = msUntilNextDaily();
    console.error(`Daily push next in ${Math.round(delay / 60000)} min (09:00 Asia/Bangkok)`);
    setTimeout(async () => {
      await sendDailyPush();
      setInterval(sendDailyPush, 24 * 60 * 60 * 1000);
    }, delay);
  }
  scheduleDailyPush();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "buddytrails-verify") return;
  const code = interaction.options.getString("code", true).trim();
  const db = getDb();
  const row = db.prepare(`SELECT code, openwebui_user_id, expires_at FROM link_codes WHERE code = ?`).get(code) as any;
  if (!row) {
    await interaction.reply({ content: `❌ Invalid code \`${code}\`. In Open WebUI, run the \`link.create\` tool to get a fresh 6-digit code (10 min expiry).`, ephemeral: true });
    return;
  }
  if (row.expires_at < new Date().toISOString()) {
    try { db.prepare(`DELETE FROM link_codes WHERE code = ?`).run(code); } catch {}
    await interaction.reply({ content: `❌ Code \`${code}\` expired. Run \`link.create\` in Open WebUI again for a new code.`, ephemeral: true });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO user_discord_link (openwebui_user_id, discord_user_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(openwebui_user_id) DO UPDATE SET discord_user_id=excluded.discord_user_id, updated_at=excluded.updated_at`).run(row.openwebui_user_id, interaction.user.id, now, now);
  try { db.prepare(`DELETE FROM link_codes WHERE code = ?`).run(code); } catch {}
  await interaction.reply({ content: `✅ Verified — linked Open WebUI \`${row.openwebui_user_id}\` → Discord <@${interaction.user.id}>. 3★ due-soon DMs will come here.`, ephemeral: true });
  try { await interaction.user.send(`✅ BuddyTrails linked: Open WebUI \`${row.openwebui_user_id}\` → this Discord account. You're all set — 3★ reminders will DM you here.`); } catch {}
});

// No MessageCreate auto-replies, no GuildCreate/UserInstall DMs — guild-only, local visible only

client.login(token);
