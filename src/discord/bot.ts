import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { tools } from "../tools.js";
import { getDb } from "../db.js";
import { runWithUser } from "../context.js";

const WELCOME_MSG = `👋 Thanks for adding BuddyTrails!\n\n**Link your Open WebUI account (2 steps):**\n1. In Open WebUI, run the \`link.create\` tool — you'll get a 6-digit code (10 min, single-use).\n2. Here in Discord, run \`/buddytrails-verify code:<code>\` (works in DMs too, no guild needed).\n\nThen 3★ due-soon reminders will DM you. You can also run \`/buddytrails-setup\` in any guild text channel or in a DM to choose where guild reminders post.`;
const welcomedUsers = new Set<string>();
async function sendWelcomeDM(userId: string) {
  if (welcomedUsers.has(userId)) return;
  welcomedUsers.add(userId);
  try {
    const user = await client.users.fetch(userId);
    await user.send(WELCOME_MSG);
    console.error(`Welcome DM sent to user ${userId}`);
  } catch (e) { console.error(`Welcome DM failed for ${userId}`, e); }
}

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN not set — bot not starting");
  process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

function withUserInstall(b: any) {
  return b.setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);
}
const commands = [
  withUserInstall(new SlashCommandBuilder().setName("buddytrails-setup").setDescription("Setup BuddyTrails — guild channel or DM").setDMPermission(true)),
  withUserInstall(new SlashCommandBuilder().setName("buddytrails-verify").setDescription("Verify Open WebUI link code (6-digit, 10 min)").addStringOption(o => o.setName("code").setDescription("6-digit code from Open WebUI link.create").setRequired(true)).setDMPermission(true)),
  withUserInstall(new SlashCommandBuilder().setName("remind").setDescription("Schedule reminder").addStringOption(o => o.setName("task_id").setDescription("Task ID").setRequired(true)).addStringOption(o => o.setName("at").setDescription("ISO time").setRequired(true))),
  withUserInstall(new SlashCommandBuilder().setName("due-soon").setDescription("Tasks due soon").addStringOption(o => o.setName("within").setDescription("24h or 3d").setRequired(false))),
  withUserInstall(new SlashCommandBuilder().setName("task-today").setDescription("Today's schedule")),
].map(c => c.toJSON());

client.once(Events.ClientReady, async () => {
  console.error(`Discord bot ready as ${client.user?.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationCommands(client.user!.id), { body: commands });
    console.error(`Registered global commands`);
  } catch (e) { console.error("Failed to register commands", e); }
  // Hourly scheduler for 3★ due/overdue — DM per linked user, plus DM-setup users
  setInterval(async () => {
    try {
      const db = getDb();
      const links = db.prepare(`SELECT openwebui_user_id, discord_user_id FROM user_discord_link`).all() as any[];
      const dmSetups = db.prepare(`SELECT guild_id, channel_id FROM discord_settings WHERE guild_id LIKE 'DM:%'`).all() as any[];
      if (links.length === 0 && dmSetups.length === 0) {
        console.error("Scheduler: no linked users or DM setups, skipping");
        return;
      }
      // Linked users: per-user filtered tasks
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
      // DM-setup users without a link: send unfiltered (local) tasks via DM channel
      const linkedIds = new Set(links.map((l: any) => l.discord_user_id));
      for (const dm of dmSetups) {
        const discordUserId = dm.guild_id.slice(3); // "DM:<id>"
        if (linkedIds.has(discordUserId)) continue; // already handled via link
        try {
          const dueSoon = tools.find(t => t.name === "task.due_soon")!;
          const res = await runWithUser(discordUserId, () => dueSoon.handler({ within: "24h" })) as any;
          const urgent = (res.tasks || []).filter((t: any) => t.priority === 3);
          if (urgent.length === 0) continue;
          const msg = `⏰ ${urgent.length} 3★ task(s) due soon:\n` + urgent.map((t: any) => `- ${t.title} (due ${t.deadline})`).join("\n");
          const ch = await client.channels.fetch(dm.channel_id) as any;
          if (ch?.send) await ch.send(msg);
          else {
            const user = await client.users.fetch(discordUserId);
            await user.send(msg);
          }
        } catch (e) { console.error(`Scheduler DM-setup failed for ${discordUserId}`, e); }
      }
    } catch (e) { console.error("Scheduler error", e); }
  }, 60 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "buddytrails-setup") {
    const gid = interaction.guildId;
    const cid = interaction.channelId;
    const db = getDb();
    const now = new Date().toISOString();
    if (!gid || !cid) {
      // DM — save as DM target (guild_id = "DM:<userId>")
      const dmKey = `DM:${interaction.user.id}`;
      db.prepare(`INSERT INTO discord_settings (guild_id, channel_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, updated_at=excluded.updated_at`).run(dmKey, cid, now, now);
      await interaction.reply({ content: `✅ BuddyTrails DM setup saved — hourly 3★ reminders will DM you here. For per-user DMs, also run \`/buddytrails-link <openwebui_user>\`.`, ephemeral: true });
      return;
    }
    db.prepare(`INSERT INTO discord_settings (guild_id, channel_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, updated_at=excluded.updated_at`).run(gid, cid, now, now);
    await interaction.reply(`✅ BuddyTrails setup saved\nGuild: ${gid}\nChannel: <#${cid}> (${cid})\nHourly 3★ reminders will post here. Re-run in another channel to move it. DMs also work — run \`/buddytrails-setup\` in a DM to get DMs there.`);
  } else if (interaction.commandName === "buddytrails-verify") {
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
  } else if (interaction.commandName === "remind") {
    const taskId = interaction.options.getString("task_id", true);
    const at = interaction.options.getString("at", true);
    // Try to resolve Open WebUI user via link; fallback to discord user id as userId
    const db = getDb();
    const link = db.prepare(`SELECT openwebui_user_id FROM user_discord_link WHERE discord_user_id = ?`).get(interaction.user.id) as any;
    const userId = link?.openwebui_user_id ?? interaction.user.id;
    const tool = tools.find(t => t.name === "task.remind")!;
    const res = await runWithUser(userId, () => tool.handler({ taskId, at, channel: interaction.channelId }));
    await interaction.reply(`Reminder set: ${JSON.stringify(res)}`);
  } else if (interaction.commandName === "due-soon") {
    const within = interaction.options.getString("within") ?? "24h";
    const db = getDb();
    const link = db.prepare(`SELECT openwebui_user_id FROM user_discord_link WHERE discord_user_id = ?`).get(interaction.user.id) as any;
    const userId = link?.openwebui_user_id ?? interaction.user.id;
    const tool = tools.find(t => t.name === "task.due_soon")!;
    const res = await runWithUser(userId, () => tool.handler({ within })) as any;
    await interaction.reply(`Due soon (${within}): ${res.tasks.length} tasks\n` + res.tasks.map((t: any) => `- ${t.title}`).join("\n").slice(0, 1800));
  } else if (interaction.commandName === "task-today") {
    const db = getDb();
    const link = db.prepare(`SELECT openwebui_user_id FROM user_discord_link WHERE discord_user_id = ?`).get(interaction.user.id) as any;
    const userId = link?.openwebui_user_id ?? interaction.user.id;
    const tool = tools.find(t => t.name === "task.get_today_schedule")!;
    const res = await runWithUser(userId, () => tool.handler({})) as any;
    await interaction.reply(`Today: ${res.blocks.length} blocks\n` + res.blocks.map((b: any) => `${b.start}-${b.end} ${b.title}`).join("\n").slice(0, 1800));
  }
});

// Normal chat auto-trigger (simple keyword routing) — uses linked Open WebUI user if available
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const text = msg.content.toLowerCase();
  const db = getDb();
  const link = db.prepare(`SELECT openwebui_user_id FROM user_discord_link WHERE discord_user_id = ?`).get(msg.author.id) as any;
  const userId = link?.openwebui_user_id ?? msg.author.id;
  if (text.includes("remind me")) {
    await msg.reply("Use /remind task_id at (ISO time) or say: remind me at 3pm to do X — I will parse it soon.");
  } else if (text.includes("what's due soon") || text.includes("whats due soon")) {
    const tool = tools.find(t => t.name === "task.due_soon")!;
    const res = await runWithUser(userId, () => tool.handler({ within: "24h" })) as any;
    await msg.reply(`Due soon: ${res.tasks.length} tasks`);
  } else if (text.includes("what's my day") || text.includes("whats my day")) {
    const tool = tools.find(t => t.name === "brief.daily")!;
    const res = await runWithUser(userId, () => tool.handler({})) as any;
    await msg.reply(`Daily brief: ${res.tasks.length} tasks today`);
  }
});

// Auto welcome when bot is added to a guild — DM the adder/inviter if possible, else post in system channel
client.on(Events.GuildCreate, async (guild) => {
  try {
    // Try to DM the guild owner as best-effort inviter
    try {
      const owner = await guild.fetchOwner();
      await owner.send(WELCOME_MSG);
      console.error(`GuildCreate welcome DM sent to owner ${owner.id} for guild ${guild.id}`);
      return;
    } catch {}
    // Fallback: try system channel
    const ch = guild.systemChannel;
    if (ch?.isTextBased() && (ch as any).send) {
      await (ch as any).send(WELCOME_MSG);
      console.error(`GuildCreate welcome sent to systemChannel for guild ${guild.id}`);
    }
  } catch (e) { console.error("GuildCreate welcome failed", e); }
});

// Auto welcome when a user installs the app (User Install) — DM on first interaction
client.on(Events.InteractionCreate, async (interaction) => {
  // Fire-and-forget welcome DM for user installs (authorizingIntegrationOwners indicates UserInstall)
  try {
    const owners = (interaction as any).authorizingIntegrationOwners as Record<string, string> | undefined;
    const isUserInstall = owners && owners["1"] != null; // 1 = UserInstall
    if (isUserInstall && interaction.user) {
      // Don't await — let command handling proceed
      void sendWelcomeDM(interaction.user.id);
    }
  } catch {}
});

client.login(token);
