import { useEffect } from 'react'

const SITE_NAME = 'BacklogVault'

// Sets the browser tab title, so tabs, history and bookmarks say where you are.
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME
  }, [title])
}
