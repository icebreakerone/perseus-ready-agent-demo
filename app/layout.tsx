import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Perseus Readiness Demo',
  description: 'A Carbon Accounting Provider completing the FSP-initiated, one-permission Perseus flow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  )
}
