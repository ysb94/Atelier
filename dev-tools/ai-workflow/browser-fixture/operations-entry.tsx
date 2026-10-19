import React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BrowserRouter,Routes,Route} from 'react-router-dom'
import {OperationsSupportPage} from '@/features/operations-support/OperationsSupportPage'
import {ProfileSettingsPage} from '@/features/settings/ProfileSettingsPage'
import {MyAttendanceStartPanel} from '@/features/settings/MyAttendanceStartPanel'
import {AttendanceStartSettingsPanel} from '@/features/operations-support/AttendanceStartSettingsPanel'
import {useOpsDirectory} from '@/features/operations-support/ops-directory'
import {useAttendanceStartSettings} from '@/features/operations-support/use-attendance-start-settings'
import '@/index.css'
const params=new URLSearchParams(location.search),mode=params.get('directory')??'ready'
const state=window as unknown as {__fixtureDirectoryMode:string;__fixtureRpcCalls:unknown[]}
state.__fixtureDirectoryMode=mode;state.__fixtureRpcCalls=[]
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}})
client.setQueryData(['departments','active'],[{id:'fixture-department',name:'운영지원',isActive:true}])
if(mode==='ready')client.setQueryData(['orgChartMembers'],[{id:'member-0',displayName:'검증 사원',position:'사원',jobGrade:'사원',departmentId:'fixture-department',hireDate:'2020-01-01'}])
client.setQueryData(['department-approvers','fixture-user',true],[{departmentId:'fixture-department',type:'leave',approverId:'fixture-user',substituteId:null}])
function Settings(){const directory=useOpsDirectory(),schedules=useAttendanceStartSettings();return <AttendanceStartSettingsPanel directory={directory} schedules={schedules}/>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><Routes>
  <Route path="/__fixture/operations" element={<OperationsSupportPage/>}/>
  <Route path="/__fixture/profile" element={<ProfileSettingsPage/>}/>
  <Route path="/__fixture/my-start" element={<MyAttendanceStartPanel departmentIds={['fixture-department']}/>}/>
  <Route path="/__fixture/start-settings" element={<Settings/>}/>
</Routes></BrowserRouter></QueryClientProvider>)
