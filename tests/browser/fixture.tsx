import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DataProvider from '../../frontend/src/components/DataProvider'
import { useDataRevision } from '../../frontend/src/core/hooks/useDataRevision'
import { coordinateRefresh } from '../../frontend/src/core/security/refresh-coordinator'
import { usePathname, navigate } from './navigation'
Object.assign(window, { startRefresh: coordinateRefresh, fixtureNavigate: navigate })

function PrivateView() {
  const revision = useDataRevision(['people', 'enrollment', 'settings'])
  const [name, setName] = useState('Loading')
  useEffect(() => {
    let current = true
    fetch('/api/hod/students').then(r => r.json()).then(data => { if (current) setName(data.name) }).catch(() => {})
    return () => { current = false }
  }, [revision])
  return <p data-testid="private-name">{name}</p>
}
function Fixture() {
  const pathname = usePathname()
  return <DataProvider>{pathname === '/login' ? <p>Sign in</p> : <PrivateView />}</DataProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
