/**
 * AgentHome — temporary placeholder for the agent (non-admin) dashboard landing.
 *
 * Task 4 will replace this with the full agent experience: order a video,
 * track active orders, view deliverables. This placeholder is intentionally
 * minimal — it exists only so the /dashboard route works for non-admin users
 * and the route×role matrix test can assert on `data-testid="agent-home"`.
 */

export default function AgentHome() {
  return (
    <div data-testid="agent-home" className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to Listing Elevate</h1>
      <p className="text-muted-foreground max-w-prose">
        Your agent dashboard is coming soon. You can manage your account and
        listings in the meantime.
      </p>
    </div>
  );
}
