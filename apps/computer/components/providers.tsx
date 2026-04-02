'use client'

import { ThemeProvider } from 'next-themes'
import { ChatProvider } from '@/lib/chat-context'
import { SessionProvider } from '@/lib/session-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <ChatProvider>
          {children}
        </ChatProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
