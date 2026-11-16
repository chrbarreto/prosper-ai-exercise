import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const agentsDir = mkdtempSync(join(tmpdir(), 'prosper-e2e-'))
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    { command: '../backend/.venv/bin/python ../backend/bot.py --host 127.0.0.1 --port 8001 -t webrtc', url: 'http://127.0.0.1:8001/api/health', env: { AGENTS_DIR: agentsDir }, timeout: 60_000 },
    { command: 'npm run dev -- --port 5174', url: 'http://127.0.0.1:5174', env: { API_TARGET: 'http://127.0.0.1:8001' }, timeout: 30_000 },
  ],
})
