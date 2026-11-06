import { defineConfig, devices } from '@playwright/test';

const PORT = 4179;
/** Production build served by `vite preview` for the one production smoke spec (R-023). */
const PREVIEW_PORT = 4178;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Few workers: the build machine is shared and heavily loaded; many browsers cold-compiling the dev
  // server at once time out together.
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /preview-smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        // SwiftShader GL hangs the compositor on this machine (requestAnimationFrame never fires, so
        // clicks/screenshots time out). The plan is Canvas2D, so software raster without GL is fine.
        // Phase 5 (WebGL 3D) may need to revisit this per-test.
        launchOptions: { args: ['--disable-gpu', '--disable-software-rasterizer'] },
      },
    },
    {
      // Production build (vite preview): DOM-only assertions, no dev hooks.
      name: 'preview',
      testMatch: /preview-smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PREVIEW_PORT}`,
        viewport: { width: 1600, height: 1000 },
        launchOptions: { args: ['--disable-gpu', '--disable-software-rasterizer'] },
      },
    },
    // Opt-in WebGL run of the 3D spec (WP_E2E_WEBGL=1) for machines whose GPU/SwiftShader works
    // headless. By default the 3D spec runs above against the software (SVG) renderer.
    ...(process.env.WP_E2E_WEBGL
      ? [
          {
            name: 'webgl',
            testMatch: /three-d\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1600, height: 1000 },
              launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: `pnpm exec vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The production bundle: built fresh, then served. This is the only server the
      // preview-smoke spec talks to.
      command: `pnpm exec vite build && pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
