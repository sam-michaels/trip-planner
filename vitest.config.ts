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
      // Parallel agent worktrees live under .claude/worktrees/ and each
      // contains a full copy of src/. Without this, a test run at the
      // repo root collects every worktree's tests alongside its own —
      // so `npm test` reports a green suite that is mostly other
      // branches' code, and a real failure here is buried in it.
      // vitest's default excludes only cover node_modules and dist.
      exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
    },
  }),
)
