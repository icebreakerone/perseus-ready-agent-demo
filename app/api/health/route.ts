export const dynamic = 'force-dynamic'

// Load balancer health check. Deliberately local: the steps call the
// Directory, Registry and EDP, so a check through them would fail whenever
// they do.
export function GET() {
  return Response.json({ status: 'ok' })
}
