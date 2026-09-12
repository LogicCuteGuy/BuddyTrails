import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { getDb } from "../db.js";

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
  // Notifications are AI-driven via notify.send — no automatic hourly/daily pushes
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
