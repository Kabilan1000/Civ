export function CitizenLink({ id, name, onSelect, dead }: { id: number; name: string; onSelect: (id: number) => void; dead?: boolean }) {
  return (
    <button type="button" className={`citizen-link${dead ? ' dead' : ''}`} onClick={() => onSelect(id)} title={`Inspect ${name}`}>
      {name}
    </button>
  )
}
