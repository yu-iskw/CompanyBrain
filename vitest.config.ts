import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      'plugins/*/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['{packages,apps,plugins}/*/src/**/*.ts'],
      exclude: [
        '{packages,apps,plugins}/*/src/**/*.{test,spec}.ts',
        '{packages,apps,plugins}/*/src/**/*.d.ts',
        '{packages,apps,plugins}/*/dist/**',
        '{packages,apps,plugins}/*/src/main.ts',
        '**/*.config.{js,mjs,cjs,ts}',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
