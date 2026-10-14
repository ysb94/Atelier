import React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BrowserRouter,Routes,Route} from 'react-router-dom'
import {CompanyLayout} from '@/components/layout/CompanyLayout'
import {BrandLayout} from '@/components/layout/BrandLayout'
import {BrandScope} from '@/components/layout/brand-context'
import {BrandSelectPage} from '@/features/brands/BrandSelectPage'
import {BrandHomePage} from '@/features/home/BrandHomePage'
import '@/index.css'
const brand={id:'fixture-brand',slug:'fixture',name:'검증 브랜드',nameKo:'검증 브랜드',color:'#222',foundedYear:2020}
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}})
client.setQueryData(['brands'],[brand])
;(window as unknown as {__brandQueryObservers:()=>number}).__brandQueryObservers=()=>client.getQueryCache().find({queryKey:['brands']})?.getObserversCount()??0
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><Routes>
 <Route path="/__brand-management" element={<BrandSelectPage/>}/>
 <Route path="/__brand-home" element={<BrandScope brand={brand}><BrandHomePage/></BrandScope>}/>
 <Route path="/b/:brandSlug/*" element={<BrandLayout/>}/>
 <Route path="*" element={<CompanyLayout/>}/>
</Routes></BrowserRouter></QueryClientProvider>)
