import LoadingState, { type LoadingLayout } from './LoadingState'

export default function PageLoading({ message = 'Loading dashboard…', layout = 'dashboard' }: { message?: string; layout?: LoadingLayout }) {
  return (
    <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
      <LoadingState message={message} layout={layout} />
    </div>
  )
}
