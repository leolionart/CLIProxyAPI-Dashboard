import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'fs'

// Use parent dir if ../.env exists (local dev), otherwise use current dir (Docker)
const envDir = existsSync('../.env') ? '..' : '.'

export default defineConfig({
    plugins: [react()],
    envDir,
    envPrefix: ['VITE_', 'SUPABASE_'],
    server: {
        host: '0.0.0.0',
        port: 5173
    },
    build: {
        outDir: 'dist',
        sourcemap: false
    }
})

