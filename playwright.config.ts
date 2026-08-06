import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // The suburb picker only renders when a Places key exists, and the specs intercept the
    // Google calls anyway — so the browser needs a key present, never a working one.
    env: { VITE_GOOGLE_MAPS_API_KEY: 'e2e-test-key' },
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
})
