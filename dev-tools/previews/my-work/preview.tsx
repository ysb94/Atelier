import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClipboardList, ArrowUpRight, Bell, Search } from 'lucide-react'
import { MyWorkDashboard } from '../../../src/features/work-requests/MyWorkDashboard'
import { companyNavGroupsForProfile, companyTopNav } from '../../../src/components/layout/company-workspace-nav'
import '../../../src/index.css'
import './preview.css'

const groups = companyNavGroupsForProfile({status:'active',position:'팀장',departmentName:'운영지원팀',departmentPersonnelScope:'members'})
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <div className="mw-preview-shell">
      <aside className="mw-preview-sidebar"><div className="mw-preview-brand">atelier<span>E&J WORKSPACE</span></div><div className="mw-preview-company">E&J <span>회사 업무 공간</span></div><nav aria-label="미리보기 메뉴">{companyTopNav.map(item=><a className={item.to==='/work'?'active':''} href={item.to==='/work'?'#':item.to} key={item.to}><item.icon size={16}/>{item.label}</a>)}<div className="mw-preview-divider"/>{groups.filter(group=>['기획','디자인','운영지원'].includes(group.title)).map(group=><div key={group.title}><h2>{group.title}</h2>{group.items.map(item=><a href={item.to} key={item.to}><item.icon size={14}/>{item.label}</a>)}</div>)}</nav><div className="mw-preview-user"><span>예</span><div>이예진<small>디자인팀 · 화면 미리보기</small></div></div></aside>
      <div className="mw-preview-main"><div className="mw-preview-top"><span>E&J <span>/</span> <ClipboardList size={13}/> 내 업무</span><div><Search size={16}/><Bell size={16}/><span>예</span></div></div><div className="mw-preview-tab"><span><ClipboardList size={13}/>내 업무 <span>×</span></span><ArrowUpRight size={13}/></div><main><MyWorkDashboard name="이예진" department="디자인팀"/></main></div>
    </div>
  </BrowserRouter>,
)
