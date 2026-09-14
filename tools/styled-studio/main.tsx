import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyledStudio } from '../../src/features/design/StyledStudio'

window.addEventListener('error', (event) => console.warn('[styled-studio] 화면 오류', { path: location.pathname, error: event.error }))
window.addEventListener('unhandledrejection', (event) => console.warn('[styled-studio] 비동기 작업 오류', { path: location.pathname, error: event.reason }))
createRoot(document.getElementById('root')!).render(<React.StrictMode><StyledStudio /></React.StrictMode>)
