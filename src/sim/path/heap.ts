// Binary min-heap of tile indices ordered by a caller-supplied comparator.
// Used by A*; not part of WorldState.

export class MinHeap {
  private readonly items: number[] = []
  private readonly less: (a: number, b: number) => boolean

  constructor(less: (a: number, b: number) => boolean) {
    this.less = less
  }

  get size(): number {
    return this.items.length
  }

  push(item: number): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(items[i]!, items[parent]!)) break
      ;[items[i], items[parent]] = [items[parent]!, items[i]!]
      i = parent
    }
  }

  pop(): number | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]!
    const last = items.pop()!
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let best = i
        if (l < items.length && this.less(items[l]!, items[best]!)) best = l
        if (r < items.length && this.less(items[r]!, items[best]!)) best = r
        if (best === i) break
        ;[items[i], items[best]] = [items[best]!, items[i]!]
        i = best
      }
    }
    return top
  }
}
