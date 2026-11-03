import { describe, expect, it } from 'vitest'
import { AppLifecycle } from './AppLifecycle.ts'

function fakeFactory() {
  const created: { destroyed: number }[] = []
  let resolveNext: (() => void) | null = null
  const factory = () =>
    new Promise<{ destroy(): void }>((resolve) => {
      resolveNext = () => {
        const app = { destroyed: 0, destroy: () => app.destroyed++ }
        created.push(app)
        resolve(app)
      }
    })
  return { factory, created, finishInit: () => resolveNext?.() }
}

describe('AppLifecycle', () => {
  it('creates the app once, even if start() is called repeatedly', async () => {
    const live = AppLifecycle.live
    const f = fakeFactory()
    const lc = new AppLifecycle(f.factory)
    const a = lc.start()
    const b = lc.start()
    expect(a).toBe(b)
    f.finishInit()
    expect(await a).not.toBeNull()
    expect(f.created).toHaveLength(1)
    expect(AppLifecycle.live).toBe(live + 1)
    lc.dispose()
    lc.dispose()
    expect(f.created[0]!.destroyed).toBe(1)
    expect(AppLifecycle.live).toBe(live)
  })

  it('destroys an app whose init finishes after dispose (StrictMode unmount)', async () => {
    const live = AppLifecycle.live
    const f = fakeFactory()
    const lc = new AppLifecycle(f.factory)
    const pending = lc.start()
    lc.dispose()
    f.finishInit()
    expect(await pending).toBeNull()
    expect(f.created[0]!.destroyed).toBe(1)
    expect(lc.current).toBeNull()
    expect(AppLifecycle.live).toBe(live)
  })

  it('never creates an app after dispose', async () => {
    const f = fakeFactory()
    const lc = new AppLifecycle(f.factory)
    lc.dispose()
    expect(await lc.start()).toBeNull()
    expect(f.created).toHaveLength(0)
  })

  it('leaves no live apps after many mount/unmount cycles', async () => {
    const live = AppLifecycle.live
    for (let i = 0; i < 20; i++) {
      const f = fakeFactory()
      const lc = new AppLifecycle(f.factory)
      const p = lc.start()
      if (i % 2 === 0) lc.dispose() // unmount before ready
      f.finishInit()
      await p
      lc.dispose()
    }
    expect(AppLifecycle.live).toBe(live)
  })
})
