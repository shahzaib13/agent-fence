/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    exclude: ['**/node_modules/**', 'e2e/**'],
    // ThinkingScreen's deliberate reveal-hold delay (Home.tsx) means a multi-turn conversation
    // test can genuinely take several seconds — comfortably above the 5s default.
    testTimeout: 20000,
  },
})
