import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './release-auth'
import { CompanyLayout } from '@/components/layout/CompanyLayout'
import { ChatWindowPage } from '@/features/chat/ChatWindowPage'
import { AttendanceEntryProvider } from '@/features/home/attendance-entry-context'
import { AttendanceEntryGate } from '@/features/home/AttendanceEntryGate'
import '@/index.css'
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false }, mutations: { retry: false } } })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><AttendanceEntryProvider><AttendanceEntryGate><Routes><Route path="/chat/room/:roomId" element={<ChatWindowPage />} /><Route path="/*" element={<CompanyLayout />} /></Routes></AttendanceEntryGate></AttendanceEntryProvider></BrowserRouter></AuthProvider></QueryClientProvider>)
