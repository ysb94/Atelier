import { useEffect, useId, useRef, useState } from 'react'
import type { UiDialogConfig } from '../types'

export function UiDialog({ request, onClose }: { request?: { config: UiDialogConfig }; onClose: (value: string | boolean | undefined | null) => void }) {
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const errorId = useId()
  useEffect(() => { setValue(request?.config.defaultValue || ''); if (request?.config.mode === 'prompt') requestAnimationFrame(() => input.current?.focus()) }, [request])
  if (!request) return null
  const { config } = request
  const inputError = config.validateInput?.(value) ?? null
  const showError = Boolean(inputError && value)
  return <div className="ui-dialog-overlay open" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(config.mode === 'alert' ? undefined : config.mode === 'prompt' ? null : false) }}>
    <div className="ui-dialog-panel">
      <h2 className="ui-dialog-title">{config.title || '알림'}</h2><p className="ui-dialog-message">{config.message}</p>
      {config.mode === 'prompt' && <input
        ref={input}
        className="ui-dialog-input"
        aria-label={config.message}
        aria-invalid={showError}
        aria-describedby={showError ? errorId : undefined}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !inputError) onClose(value)
        }}
      />}
      {showError && <p id={errorId} role="status" className="text-sm text-danger">{inputError}</p>}
      <div className="ui-dialog-actions">
        {config.mode !== 'alert' && <button className="ui-dialog-btn" onClick={() => onClose(config.mode === 'prompt' ? null : false)}>{config.cancelText || '취소'}</button>}
        <button disabled={Boolean(inputError)} className={`ui-dialog-btn disabled:opacity-50 ${config.danger ? 'danger' : 'primary'}`} onClick={() => onClose(config.mode === 'prompt' ? value : config.mode === 'confirm' ? true : undefined)}>{config.okText || '확인'}</button>
      </div>
    </div>
  </div>
}
