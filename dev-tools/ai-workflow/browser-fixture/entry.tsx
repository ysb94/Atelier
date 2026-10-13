import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkRequestPage } from '@/features/work-requests/WorkRequestPage'
import { CompanyHomePage } from '@/features/home/CompanyHomePage'
import { MyAttendancePanel } from '@/features/settings/MyAttendancePanel'
import { MyAttendanceStartPanel } from '@/features/settings/MyAttendanceStartPanel'
import { AttendancePanel } from '@/features/operations-support/AttendancePanel'
import '@/index.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
client.setQueryData(['departments','active'], [{ id:'fixture-department', name:'운영지원', isActive:true }])
client.setQueryData(['orgChartMembers'], ['사원','팀장','이사','상무','전무','부사장','대표이사'].map((position,i)=>({
  id:`member-${i}`, displayName:`검증 ${position}`, status:'active', position, jobGrade:'사원',
  departmentId:'fixture-department', isAdmin:false, capabilities:[], memberships:[],
})))
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><BrowserRouter><Routes>
    <Route path="/work-requests/:owner" element={<WorkRequestPage/>}/>
    <Route path="/home" element={<CompanyHomePage/>}/>
    <Route path="/my-attendance" element={<MyAttendancePanel/>}/>
    <Route path="/attendance" element={<AttendancePanel/>}/>
    <Route path="/my-start" element={<MyAttendanceStartPanel departmentIds={['fixture-department']}/>}/>
  </Routes></BrowserRouter></QueryClientProvider>
)
