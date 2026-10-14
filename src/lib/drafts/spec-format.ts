export type SizeParts = {
  width: string
  depth: string
  height: string
  strap: string
}

export function parseSizeSpec(value: string): SizeParts {
  function labeled(label: string) {
    const match = value.match(
      new RegExp(`(?:\\[${label}\\]|${label}\\s*=?)\\s*([\\d.]+)`, 'i'),
    )
    return match?.[1] ?? ''
  }
  const width = labeled('W')
  const depth = labeled('D')
  const height = labeled('H')
  const strap = value.match(/(?:STRAP|어깨끈|끈)[^\d]*([\d.]+)/i)?.[1] ?? ''

  if (width || depth || height || strap) {
    return { width, depth, height, strap }
  }

  const numbers = value.match(/\d+(?:\.\d+)?/g) ?? []
  return {
    width: numbers[0] ?? '',
    depth: numbers[1] ?? '',
    height: numbers[2] ?? '',
    strap: numbers[3] ?? '',
  }
}

export function formatSizeSpec(parts: SizeParts) {
  if (!Object.values(parts).some(Boolean)) return ''
  return `W=${parts.width};D=${parts.depth};H=${parts.height};STRAP=${parts.strap};UNIT=mm`
}

/** 목록 버튼에 보여줄 사이즈. 저장값은 W=… 형식이다. */
export function formatSizeSpecLabel(value: string) {
  const text = value.trim()
  if (!text) return ''
  const size = parseSizeSpec(text)
  const dims = [size.width, size.depth, size.height].filter(Boolean)
  if (!dims.length) return text
  const strap = size.strap ? ` · 끈 ${size.strap}` : ''
  return `${dims.join('×')} mm${strap}`
}

/** 목록에서 입력한 사이즈를 상세 화면 저장 형식으로 바꾼다. */
export function parseSizeSpecInput(raw: string) {
  const text = raw.trim()
  if (!text) return ''
  if (/W\s*=/i.test(text) || /UNIT\s*=/i.test(text)) {
    return formatSizeSpec(parseSizeSpec(text))
  }
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? []
  if (!numbers.length) return text
  return formatSizeSpec({
    width: numbers[0] ?? '',
    depth: numbers[1] ?? '',
    height: numbers[2] ?? '',
    strap: numbers[3] ?? '',
  })
}
