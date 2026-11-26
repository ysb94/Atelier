import React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BrowserRouter} from 'react-router-dom'
import {MembersPage} from '@/features/settings/MembersPage'
import {OperationsPeoplePanel} from '@/features/operations-support/OperationsPeoplePanel'
import '@/index.css'
const fixture=window as unknown as {__fixtureDepartments:Record<string,unknown>[];__fixtureDepartmentCalls:unknown[];__fixtureDepartmentFailure:boolean}
fixture.__fixtureDepartments=[
  ['fixture-department','기존 부서'],['fixture-bag','기획팀_[BAG]'],['fixture-apparel','기획팀_[APPAREL]'],
  ['fixture-md','MD Team'],['fixture-operations','운영지원팀'],
].map(([id,name],sort_order)=>({id,company_id:'fixture-company',name,sort_order,is_active:true,personnel_scope:null}))
fixture.__fixtureDepartmentCalls=[];fixture.__fixtureDepartmentFailure=false
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
const embedded=new URLSearchParams(location.search).has('people')
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter>{embedded?<OperationsPeoplePanel/>:<MembersPage/>}</BrowserRouter></QueryClientProvider>)
