---
name: buddytrails-mcp
status: in_progress
branch: main
last_updated: 2026-09-11
---

# Where I am
BuddyTrails MCP is guild-only Discord (verify + hourly 3★ DM), shared Knowledge + private Ideas/Tasks per X-User-Id, with triage/time skills and knowledge-store hook; docs updated and tests green.

# Next step
Resume next feature or bug — run `npm run typecheck && npm test` to verify, then pick next workstream.

# Blocking on
- None

# Open threads
1. Discord guild-only verify — done — src/discord/bot.ts — tests pass — GuildInstall/Guild only, link.create → buddytrails-verify, hourly DM
2. Skills + hook — done — .agents/skills/buddytrails-* + .github/hooks/knowledge-store.json — tests pass — triage/time as docs, no extra MCP tools
3. Docs — done — README.md, docs/SETUP.md, .env.example — tests pass — guild-only install guide

# Decision log
- 2026-09-11: Keep MCP lean — triage/time via skills, not new tools — per user "let the skills handle it"
- 2026-09-11: Guild-only Discord with DM notifications for linked users — user toggled User Install off then re-enabled DMs
- 2026-09-11: Flipped link flow 6-digit 10m single-use — Q1:b Q2:a Q3:a Q4:b
