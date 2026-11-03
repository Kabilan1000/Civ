export interface WorldFit {
  scale: number
  x: number
  y: number
}

/** Scale the world to fit inside the viewport, preserving aspect ratio, centred. */
export function fitWorld(viewW: number, viewH: number, worldW: number, worldH: number): WorldFit {
  if (viewW <= 0 || viewH <= 0 || worldW <= 0 || worldH <= 0) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(viewW / worldW, viewH / worldH)
  return { scale, x: (viewW - worldW * scale) / 2, y: (viewH - worldH * scale) / 2 }
}
