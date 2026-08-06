import { resolve } from 'path'
import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // Nested git worktrees under the git-ignored .claude/ dir carry their own full
    // test suites (and run under the wrong env). Keep the runner to THIS checkout's tests.
    exclude: [...configDefaults.exclude, '**/.claude/**']
  }
})
