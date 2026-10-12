import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // SwiftShader keeps WebGL working in headless CI.
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } },
    },
    {
      name: 'iphone-landscape',
      use: {
        ...devices['iPhone 14'],
        // Chromium cannot emulate WebKit, but the viewport and touch
        // behaviour match iPhone 14 landscape with Safari chrome visible.
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
        defaultBrowserType: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'SKYRUSH_BASE=/ npm run build && npm run preview',
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
