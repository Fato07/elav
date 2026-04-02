# CLAUDE.md — ELAV Computer Use

## Project Overview
This is a fork of [E2B Surf](https://github.com/e2b-dev/surf) — a Next.js app that lets AI agents interact with a virtual desktop via E2B sandboxes. We're extending it into **ELAV Computer Use**, a multi-model computer use product.

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **UI:** React 19, Tailwind CSS v4, Radix UI, Framer Motion
- **Desktop Sandbox:** E2B Desktop SDK (`@e2b/desktop`)
- **AI SDKs:** OpenAI SDK (existing), Anthropic SDK (adding)
- **Streaming:** Server-Sent Events (SSE) via custom streaming lib
- **Styling:** Tailwind CSS with CSS variables for theming

## Key Architecture
- `lib/streaming/index.ts` — Abstract `ComputerInteractionStreamerFacade` class
- `lib/streaming/openai.ts` — OpenAI GPT-5.4 computer use implementation
- `app/api/chat/route.ts` — POST handler that creates sandbox + streams SSE
- `lib/chat-context.tsx` — React context for chat state + SSE parsing
- `lib/config.ts` — Model config, sandbox timeout, resolution settings

## Commands
```bash
npm install        # Install dependencies
npm run dev        # Start dev server (port 3000)
npm run build      # Build for production
npm run lint       # Run ESLint
```

## Environment Variables
```
E2B_API_KEY=       # E2B sandbox API key
OPENAI_API_KEY=    # OpenAI API key
ANTHROPIC_API_KEY= # Anthropic API key (new)
```
