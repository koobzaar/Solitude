import { useEffect, useState } from 'react'
import { loadState, saveState } from './storage'
import type { PersistenceNoticeCode } from './storage'
import type { StoredStateV3 } from './types'

export function usePersistentState(): {
  state: StoredStateV3
  setState: React.Dispatch<React.SetStateAction<StoredStateV3>>
  notice?: PersistenceNoticeCode
  clearNotice: () => void
  showNotice: (notice: PersistenceNoticeCode) => void
} {
  const [loaded] = useState(() => loadState())
  const [state, setState] = useState(loaded.state)
  const [notice, setNotice] = useState<PersistenceNoticeCode | undefined>(
    loaded.recovered ? 'recovered' : loaded.notice,
  )

  useEffect(() => {
    const result = saveState(state)
    if (!result.ok) setNotice('saveFailed')
  }, [state])

  return {
    state,
    setState,
    notice,
    clearNotice: () => setNotice(undefined),
    showNotice: (message) => setNotice(message),
  }
}
