type Point = { x: number; y: number }

/** 불투명 제품의 인쇄면이 부분 투명해지는 것과 내부의 잘못된 구멍을 복원한다. */
export function solidifyProductAlpha(pixels: Uint8ClampedArray, width: number, height: number): void {
  if (pixels.length !== width * height * 4) throw new Error('제품 마스크 크기가 일치하지 않습니다.')
  const outside = new Uint8Array(width * height), queue = new Int32Array(width * height)
  let head = 0, tail = 0
  const labels = new Int32Array(width * height), sizes = [0]
  let largest = 0
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || pixels[start * 4 + 3] < 16) continue
    const label = sizes.length
    head = 0; tail = 1; queue[0] = start; labels[start] = label
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || labels[next] || pixels[next * 4 + 3] < 16) continue
        labels[next] = label; queue[tail++] = next
      }
    }
    sizes.push(tail); largest = Math.max(largest, tail)
  }
  // 본체와 떨어진 작은 회전판·배경 조각만 지운다. 분리된 큰 부품은 유지한다.
  for (let i = 0; i < labels.length; i++) if (labels[i] && sizes[labels[i]] < Math.max(4, largest * 0.005)) pixels[i * 4 + 3] = 0
  head = 0; tail = 0
  const visit = (index: number) => {
    if (outside[index] || pixels[index * 4 + 3] >= 64) return
    outside[index] = 1; queue[tail++] = index
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1) }
  while (head < tail) {
    const index = queue[head++], x = index % width
    if (x) visit(index - 1)
    if (x < width - 1) visit(index + 1)
    if (index >= width) visit(index - width)
    if (index < width * (height - 1)) visit(index + width)
  }
  for (let i = 0; i < outside.length; i++) if (!outside[i]) pixels[i * 4 + 3] = 255
}
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** 선택 모델은 물체 범위만 제한한다. 내부 구멍·가는 경계의 알파는 매팅 모델에 맡긴다. */
export function selectionHull(data: ArrayLike<number>, width: number, height: number, offset = 0): Point[] {
  const points: Point[] = []
  for (let y = 0; y < height; y++) {
    let left = width, right = -1, count = 0
    for (let x = 0; x < width; x++) if (data[offset + y * width + x]) { left = Math.min(left, x); right = x; count++ }
    if (count >= 3) points.push({ x: left, y }, { x: right, y })
  }
  if (points.length < 3) throw new Error('제품 선택 AI가 유효한 영역을 찾지 못했습니다. 제품 영역을 다시 지정해 주세요.')
  points.sort((a, b) => a.x - b.x || a.y - b.y)
  const lower: Point[] = [], upper: Point[] = []
  for (const point of points) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop(); lower.push(point) }
  for (const point of [...points].reverse()) { while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop(); upper.push(point) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}
