// Day/night look, driven purely by the simulation clock (minutes since
// midnight). Night is rendered by TINTING existing layers — a colour
// multiply that costs no extra pixels — never by a full-screen overlay.

/** Darkness keyframes (minute of day → 0 bright … 1 darkest), linearly interpolated. */
const KEYFRAMES: readonly (readonly [number, number])[] = [
  [0, 1],
  [5 * 60, 1], // 05:00 still dark
  [7 * 60, 0], // 07:00 full daylight (dawn brightens 05–07)
  [19 * 60, 0], // 19:00 dusk begins
  [22 * 60, 1], // 22:00 full night
  [24 * 60, 1],
]

export function darknessAt(minuteOfDay: number): number {
  const m = ((minuteOfDay % 1440) + 1440) % 1440
  for (let i = 1; i < KEYFRAMES.length; i++) {
    const [m1, d1] = KEYFRAMES[i]!
    if (m <= m1) {
      const [m0, d0] = KEYFRAMES[i - 1]!
      return d0 + ((d1 - d0) * (m - m0)) / (m1 - m0)
    }
  }
  return 1
}

/** Channel-wise linear blend between two RGB colours, t in [0, 1]. */
export function lerpColor(a: number, b: number, t: number): number {
  const ch = (shift: number) => {
    const ca = (a >> shift) & 0xff
    const cb = (b >> shift) & 0xff
    return Math.round(ca + (cb - ca) * t)
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** Scene (terrain, resources, buildings) tint at full night. */
export const NIGHT_SCENE_TINT = 0x3e4c78
/** Citizens are tinted less so they stay readable. */
export const NIGHT_CITIZEN_TINT = 0xa3add0

export interface Lighting {
  darkness: number
  sceneTint: number
  citizenTint: number
  /** Opacity of light sources (campfire glow, lit windows). */
  lightAlpha: number
}

export function lightingAt(minuteOfDay: number): Lighting {
  const darkness = darknessAt(minuteOfDay)
  return {
    darkness,
    sceneTint: lerpColor(0xffffff, NIGHT_SCENE_TINT, darkness),
    citizenTint: lerpColor(0xffffff, NIGHT_CITIZEN_TINT, darkness),
    lightAlpha: 0.06 + 0.64 * darkness,
  }
}
