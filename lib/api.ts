import { NextResponse } from 'next/server'

export const errorResponse = (err: unknown, status = 400) =>
  NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status })
