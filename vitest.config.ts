import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__root-project-has-no-tests__/**/*.test.ts'],
    projects: [
      'apps/*/vitest.config.ts',
      'packages/*/vitest.config.ts',
      'plugins/*/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'packages/application/src/**/*.ts',
        'packages/persistence/src/**/*.ts',
        'packages/plugin-sdk/src/**/*.ts',
        'plugins/github/src/**/*.ts',
        'plugins/slack/src/**/*.ts',
      ],
      exclude: [
        '{apps,packages,plugins}/*/src/**/*.{test,spec}.ts',
        '{apps,packages,plugins}/*/src/**/*.d.ts',
        '{apps,packages,plugins}/*/dist/**',
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
