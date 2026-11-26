import React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BrowserRouter} from 'react-router-dom'
import {MembersPage} from '@/features/settings/MembersPage'
import {OperationsPeoplePanel} from '@/features/operations-support/OperationsPeoplePanel'
import '@/index.css'
const fixture=window as unknown as {__fixtureDepartments:Record<string,unknown>[];__fixtureDepartmentCalls:unknown[];__fixtureDepartmentFailure:boolean}
fixture.__fixtureDepartments=[{id:'fixture-department',company_id:'fixture-company',name:'기존 부서',sort_order:0,is_active:true,personnel_scope:null}]
fixture.__fixtureDepartmentCalls=[];fixture.__fixtureDepartmentFailure=false
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
const embedded=new URLSearchParams(location.search).has('people')
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter>{embedded?<OperationsPeoplePanel/>:<MembersPage/>}</BrowserRouter></QueryClientProvider>)
