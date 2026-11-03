// The inspected citizen is UI state, remembered together with the world it
// belongs to. Citizen ids are reused across worlds (load / restart), so a
// selection from another world is never applied to the new one.

export interface Selection {
  worldId: number
  citizenId: number
}

export function selectedIn(selection: Selection | null, worldId: number): number | null {
  return selection && selection.worldId === worldId ? selection.citizenId : null
}
