import { NextResponse } from "next/server";
import {
  getAllSessions,
  createSession,
  getTotalSpend,
} from "@/lib/sessions/store";
import { ModelProvider } from "@/lib/config";

export async function GET() {
  const sessions = getAllSessions();
  const totalSpend = getTotalSpend();
  return NextResponse.json({ sessions, totalSpend });
}

export async function POST(request: Request) {
  const {
    provider,
    sandboxId,
    systemPrompt,
  }: {
    provider: ModelProvider;
    sandboxId?: string;
    systemPrompt?: string;
  } = await request.json();
  const session = createSession(provider, sandboxId, systemPrompt);
  return NextResponse.json(session, { status: 201 });
}
