const labels: Record<string, string> = {
  queued: 'Queued · waiting for worker',
  running: 'Algorithm Running (Rounds 1–3)...',
  completed: 'Completed',
  failed: 'Failed',
}

export default function AllocationStatusBadge({ status }: { status?: string }) {
  const label = status ? labels[status] ?? 'Status unavailable' : 'Not Started'
  return <span data-allocation-status={status || 'idle'}>{label}</span>
}
