# ADR-0001: Local Mac app; agent = `claude -p` subprocess with the user's login

Date: 2026-08-29. Status: accepted.

## Decision
Electron app, local only. The agent is the user's installed Claude Code CLI, spawned as
`claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`,
one long-lived process per session.

## Why
- User wants "Claude Code inside", free with the existing subscription. The CLI uses the keychain login.
- Agent SDK docs disallow offering claude.ai login in third-party products; the CLI path avoids that question.
- The stream-json control channel already carries permission prompts (`can_use_tool`), interrupts, model/mode switches, and in-process MCP (`type: "sdk"`), so no HTTP server and no API key.

## Consequences
- Everything in `~/.claude` loads (hooks, MCP servers, skills, plugins). Startup takes seconds; context cost follows the user's config.
- Terminal-only chrome (`/login`, `/theme`, `/vim`...) is out of scope. Login expiry shows a banner pointing at `claude login`.
- Rejected: Vercel/hosted (no filesystem, no subscription auth), Agent SDK + API key (extra cost), Tauri (two languages).
