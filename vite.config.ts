import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the build runs from any static folder or host path.
  base: './',
  test: {
    // Engine tests run in plain Node: the simulation must not need a browser.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Simulation tests run thousands of ticks; 5 s (the default) flakes on a busy machine.
    testTimeout: 30_000,
  },
})
