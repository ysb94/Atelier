import React,{useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BrowserRouter,Routes,Route,useNavigate} from 'react-router-dom'
import {resolveWorkspaceTab} from '@/components/layout/workspace-tabs'
import {CompanyLayout} from '@/components/layout/CompanyLayout'
import {BrandLayout} from '@/components/layout/BrandLayout'
import {BrandScope} from '@/components/layout/brand-context'
import {BrandSelectPage} from '@/features/brands/BrandSelectPage'
import {BrandHomePage} from '@/features/home/BrandHomePage'
import '@/index.css'
const brand={id:'fixture-brand',slug:'fixture',name:'검증 브랜드',nameKo:'검증 브랜드',description:'브랜드 검사 설명',color:'#222222',foundedYear:2020,styleCount:3}
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}})
client.setQueryData(['brands'],[brand])
client.setQueryData(['brand','fixture'],brand)
;(window as unknown as {__brandQueryObservers:()=>number}).__brandQueryObservers=()=>client.getQueryCache().find({queryKey:['brands']})?.getObserversCount()??0
;(window as unknown as {__fixtureResolveTab:typeof resolveWorkspaceTab}).__fixtureResolveTab=resolveWorkspaceTab
function FixtureNavigation(){const navigate=useNavigate();useEffect(()=>{(window as unknown as {__fixtureNavigate:(to:string)=>void}).__fixtureNavigate=to=>navigate(to)},[navigate]);return null}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><FixtureNavigation/><Routes>
 <Route path="/__brand-management" element={<BrandSelectPage/>}/>
 <Route path="/__brand-home" element={<BrandScope brand={brand}><BrandHomePage/></BrandScope>}/>
 <Route path="/b/:brandSlug/*" element={<BrandLayout/>}/>
 <Route path="*" element={<CompanyLayout/>}/>
</Routes></BrowserRouter></QueryClientProvider>)
