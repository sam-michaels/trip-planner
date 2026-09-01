import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Merge into vite.config.ts (via mergeConfig) rather than defining a
// standalone config: this is the one place a lone vitest.config.ts is
// riskiest, since it *replaces* rather than extends vite.config.ts, and
// would silently drop the maplibre-gl optimizeDeps.exclude workaround
// documented there. Merging keeps that single source of truth intact
// for anything that ever needs it (e.g. a future test that touches the
// map).
//
// Environment is jsdom rather than node: most of what exists today
// (src/lib/geo.ts, routing, the trip model) is pure logic that doesn't
// care, but Wave 2 units are expected to test React components, which
// do. Paying jsdom's small startup cost everywhere is simpler than
// splitting environments per file for a repo this size.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // Agent worktrees under .claude/ are full checkouts of other
      // branches, so their test files look exactly like ours and vitest
      // collects them: 286 of 333 tests were coming from ten stale
      // worktrees, running code from branches nobody is on. Worse than
      // the noise and the 7x runtime is the failure mode — a broken test
      // on an abandoned branch would fail the suite here, for a file
      // that isn't in this working tree at all.
      //
      // Spread configDefaults.exclude rather than replacing it: setting
      // `exclude` overrides vitest's defaults wholesale, which would
      // quietly re-admit node_modules and dist.
      exclude: [...configDefaults.exclude, '**/.claude/**'],
      // Stands in for browser APIs jsdom leaves out — currently just
      // `<dialog>`'s modal methods. See the file for what it does and
      // deliberately does not emulate.
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
)
