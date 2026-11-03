// Guards the async create/destroy lifecycle of a rendering application.
//
// PixiJS 8 apps initialise asynchronously, and React StrictMode mounts,
// unmounts and remounts effects. This wrapper guarantees:
//   • the factory runs at most once per lifecycle (start() is idempotent);
//   • dispose() before initialisation finishes destroys the app as soon as it
//     is ready and start() resolves to null;
//   • dispose() is idempotent and every created app is destroyed exactly once.
// AppLifecycle.live counts apps that are created and not yet destroyed.

export interface Destroyable {
  destroy(): void
}

export class AppLifecycle<T extends Destroyable> {
  static live = 0

  private readonly factory: () => Promise<T>
  private promise: Promise<T | null> | null = null
  private app: T | null = null
  private disposed = false

  constructor(factory: () => Promise<T>) {
    this.factory = factory
  }

  get current(): T | null {
    return this.app
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  start(): Promise<T | null> {
    if (this.promise) return this.promise
    if (this.disposed) return (this.promise = Promise.resolve(null))
    this.promise = this.factory().then((app) => {
      AppLifecycle.live++
      if (this.disposed) {
        this.destroyApp(app)
        return null
      }
      this.app = app
      return app
    })
    return this.promise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.app) {
      this.destroyApp(this.app)
      this.app = null
    }
  }

  private destroyApp(app: T): void {
    AppLifecycle.live--
    app.destroy()
  }
}
