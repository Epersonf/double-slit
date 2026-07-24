import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project sites are served from /<repo>/, so assets must be
  // referenced with that prefix. The deploy workflow sets VITE_BASE_PATH;
  // local dev/build falls back to root.
  base: process.env.VITE_BASE_PATH ?? '/',
})
