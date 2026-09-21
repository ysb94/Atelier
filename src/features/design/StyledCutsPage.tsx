import { studioImageApi } from '../../lib/supabase/styled-image'
import { useRenderWatch } from '@/lib/diagnostics'
import { StyledStudio } from './StyledStudio'

export function DesignStyledCutsPage() {
  useRenderWatch('DesignStyledCutsPage')
  return (
    <div className="cs-cuts-page is-studio h-full min-h-0">
      <div className="cs-cuts-studio">
        <StyledStudio api={studioImageApi} />
      </div>
    </div>
  )
}
