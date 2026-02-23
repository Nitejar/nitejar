import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.ts'],
      exclude: ['server/**/*.test.ts', 'server/**/*.d.ts'],
      thresholds: {
        statements: 1,
        branches: 1,
        functions: 1,
        lines: 1,
      },
    },
  },
})
