/** Pool of unique citizen names. citizenCount can't exceed its length. */
export const CITIZEN_NAMES: readonly string[] = [
  'Ada', 'Bram', 'Cora', 'Dov', 'Elin', 'Fenn', 'Gala', 'Hale', 'Iris',
  'Joss', 'Kira', 'Lio', 'Mira', 'Nils', 'Oona', 'Pell', 'Quin', 'Rhea',
  'Sol', 'Tam', 'Una', 'Vale', 'Wren', 'Yara', 'Zeb',
]

/**
 * Names for citizens born in the world (Population V1). Kept separate from
 * CITIZEN_NAMES so the founders' names (shuffled from that list) are exactly
 * as in v0.1. A newborn gets a name no living citizen has; once every name is
 * in use, a numeral is added ("Ada II").
 */
export const NEWBORN_NAMES: readonly string[] = [
  'Abel', 'Alba', 'Arlo', 'Asha', 'Bea', 'Bex', 'Cai', 'Cleo', 'Dara', 'Eda',
  'Emil', 'Esme', 'Faye', 'Finn', 'Gil', 'Greta', 'Hana', 'Hugo', 'Ida', 'Ivo',
  'Jade', 'Juno', 'Kai', 'Kit', 'Lark', 'Lena', 'Luca', 'Maia', 'Milo', 'Nell',
  'Nico', 'Noor', 'Odo', 'Olive', 'Orin', 'Pia', 'Pip', 'Ren', 'Rio', 'Rosa',
  'Rue', 'Sage', 'Sami', 'Sela', 'Tess', 'Teo', 'Tova', 'Uri', 'Vera', 'Vik',
  'Willa', 'Xan', 'Yael', 'Yuri', 'Zara', 'Zoe', 'Ash', 'Bryn', 'Cy', 'Dell',
]
