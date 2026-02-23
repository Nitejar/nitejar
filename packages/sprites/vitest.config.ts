import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        statements: 20,
        branches: 65,
        functions: 44,
        lines: 20,
      },
    },
  },
})
