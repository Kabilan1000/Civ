import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Engine tests run in plain Node: the simulation must not need a browser.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
