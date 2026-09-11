import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } from "discord.js";
import { tools } from "../tools.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const channelId = process.env.DISCORD_CHANNEL_ID;

if (!token) {
  console.error("DISCORD_TOKEN not set — bot not starting");
  process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const commands = [
  new SlashCommandBuilder().setName("buddytrails-setup").setDescription("Setup BuddyTrails in this guild/channel"),
  new SlashCommandBuilder().setName("remind").setDescription("Schedule reminder").addStringOption(o => o.setName("task_id").setDescription("Task ID").setRequired(true)).addStringOption(o => o.setName("at").setDescription("ISO time").setRequired(true)),
  new SlashCommandBuilder().setName("due-soon").setDescription("Tasks due soon").addStringOption(o => o.setName("within").setDescription("24h or 3d").setRequired(false)),
  new SlashCommandBuilder().setName("task-today").setDescription("Today's schedule"),
].map(c => c.toJSON());

client.once(Events.ClientReady, async () => {
  console.error(`Discord bot ready as ${client.user?.tag}`);
  if (guildId) {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), { body: commands });
    console.error(`Registered guild commands for ${guildId}`);
  }
  // Hourly scheduler for 3★ due/overdue
  setInterval(async () => {
    try {
      const dueSoon = tools.find(t => t.name === "task.due_soon")!;
      const res = await dueSoon.handler({ within: "24h" }) as any;
      const urgent = (res.tasks || []).filter((t: any) => t.priority === 3);
      if (urgent.length > 0) {
        const msg = `⏰ ${urgent.length} 3★ task(s) due soon:\n` + urgent.map((t: any) => `- ${t.title} (due ${t.deadline})`).join("\n");
        if (channelId) {
          const ch = await client.channels.fetch(channelId) as any;
          if (ch?.send) await ch.send(msg);
        } else {
          // DM fallback — try owner
          console.error(msg);
        }
      }
    } catch (e) { console.error("Scheduler error", e); }
  }, 60 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "buddytrails-setup") {
    await interaction.reply(`Guild: ${interaction.guildId}\nChannel: ${interaction.channelId}\nSet DISCORD_GUILD_ID=${interaction.guildId} DISCORD_CHANNEL_ID=${interaction.channelId}`);
  } else if (interaction.commandName === "remind") {
    const taskId = interaction.options.getString("task_id", true);
    const at = interaction.options.getString("at", true);
    const tool = tools.find(t => t.name === "task.remind")!;
    const res = await tool.handler({ taskId, at, channel: interaction.channelId });
    await interaction.reply(`Reminder set: ${JSON.stringify(res)}`);
  } else if (interaction.commandName === "due-soon") {
    const within = interaction.options.getString("within") ?? "24h";
    const tool = tools.find(t => t.name === "task.due_soon")!;
    const res = await tool.handler({ within }) as any;
    await interaction.reply(`Due soon (${within}): ${res.tasks.length} tasks\n` + res.tasks.map((t: any) => `- ${t.title}`).join("\n").slice(0, 1800));
  } else if (interaction.commandName === "task-today") {
    const tool = tools.find(t => t.name === "task.get_today_schedule")!;
    const res = await tool.handler({}) as any;
    await interaction.reply(`Today: ${res.blocks.length} blocks\n` + res.blocks.map((b: any) => `${b.start}-${b.end} ${b.title}`).join("\n").slice(0, 1800));
  }
});

// Normal chat auto-trigger (simple keyword routing)
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const text = msg.content.toLowerCase();
  if (text.includes("remind me")) {
    await msg.reply("Use /remind task_id at (ISO time) or say: remind me at 3pm to do X — I will parse it soon.");
  } else if (text.includes("what's due soon") || text.includes("whats due soon")) {
    const tool = tools.find(t => t.name === "task.due_soon")!;
    const res = await tool.handler({ within: "24h" }) as any;
    await msg.reply(`Due soon: ${res.tasks.length} tasks`);
  } else if (text.includes("what's my day") || text.includes("whats my day")) {
    const tool = tools.find(t => t.name === "brief.daily")!;
    const res = await tool.handler({}) as any;
    await msg.reply(`Daily brief: ${res.tasks.length} tasks today`);
  }
});

client.login(token);
