import { useEffect } from 'react'
import type { ContextMenuState } from '../useDesignFileManager'

export function ContextMenu({ menu, close }: { menu: ContextMenuState; close: () => void }) {
  useEffect(() => { const listener = () => close(); document.addEventListener('mousedown', listener); return () => document.removeEventListener('mousedown', listener) }, [close])
  if (!menu) return null
  return <div className="ctx-menu open" style={{ left: menu.x, top: menu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
    {menu.items.map((item, index) => item.separator ? <div key={index} className="ctx-menu-separator" /> : <button key={index} className={`ctx-menu-item${item.danger ? ' danger' : ''}`} disabled={item.disabled} onClick={async () => { close(); await item.action() }}>{item.label}</button>)}
  </div>
}
