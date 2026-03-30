<p align="center">
  <h1 align="center">ELAV — AI Agent Fleet for Your Business</h1>
</p>

<p align="center">
  <strong>7 specialized AI agents. One orchestration platform. Computer use built in.</strong>
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://elav.ai"><strong>Website</strong></a> &middot;
  <a href="https://github.com/Fato07/elav"><strong>GitHub</strong></a>
</p>

<p align="center">
  <a href="https://github.com/Fato07/elav/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

<br/>

## What is ELAV?

Open-source orchestration platform that coordinates AI agent teams. Forked from [Paperclip](https://github.com/paperclipai/paperclip) (MIT), rebuilt for enterprise AI operations.

ELAV is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track your agents' work and costs from one dashboard.

It looks like a task manager — but under the hood it has org charts, budgets, governance, goal alignment, and agent coordination.

**Manage business goals, not pull requests.**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

## Key Features

<table>
<tr>
<td align="center" width="33%">
<h3>🖥️ Computer Use</h3>
AI agents that see and control desktops, powered by Claude Sonnet 4 via E2B + Anthropic.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Orchestrator</h3>
Decompose complex goals into subtask DAGs, executed automatically across your agent fleet.
</td>
<td align="center" width="33%">
<h3>💰 Usage Tracking</h3>
Real-time cost monitoring per agent, per task. Monthly budgets enforced — no runaway spend.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Approval Checkpoints</h3>
Human-in-the-loop for risky actions. You're the board — approve, override, or pause any agent.
</td>
<td align="center">
<h3>📊 Dashboard</h3>
Org charts, budgets, goals, agent coordination — monitor and manage from one place.
</td>
<td align="center">
<h3>🔌 Multi-Agent</h3>
OpenClaw, Claude Code, Codex, Cursor support. If it can receive a heartbeat, it's hired.
</td>
</tr>
</table>

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>
</div>

<br/>

## ELAV is right for you if

- You want to build **autonomous AI companies**
- You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common goal
- You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- You want to **monitor costs** and enforce budgets
- You want a process for managing agents that **feels like using a task manager**
- You want to manage your autonomous businesses **from your phone**

<br/>

## Quickstart

Open source. Self-hosted. No account required.

```bash
npx paperclipai onboard --yes
```

Or manually:

```bash
git clone https://github.com/Fato07/elav.git
cd elav
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required.

> **Requirements:** Node.js 20+, pnpm 9.15+

<br/>

## Pricing

| Plan | Price | Details |
| ---- | ----- | ------- |
| **Self-hosted** | Free | MIT license, run on your own infra |
| **Starter** | €800/mo | Managed hosting, standard support |
| **Pro** | €1,500/mo | Managed hosting, priority support, SLAs |

<br/>

## FAQ

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

**Can I run multiple companies?**
Yes. A single deployment can run an unlimited number of companies with complete data isolation.

**How is ELAV different from agents like OpenClaw or Claude Code?**
ELAV _uses_ those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability.

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents like OpenClaw. You bring your agent and ELAV coordinates.

<br/>

## Development

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test:run         # Run tests
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details.

<br/>

## Community

- [GitHub Issues](https://github.com/Fato07/elav/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/Fato07/elav/discussions) — ideas and RFC

<br/>

## Credits

Built on [Paperclip](https://github.com/paperclipai/paperclip) (MIT). Computer use powered by [E2B](https://e2b.dev) + [Anthropic](https://anthropic.com).

## License

MIT &copy; 2026 ELAV

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to run companies, not babysit agents.</sub>
</p>
