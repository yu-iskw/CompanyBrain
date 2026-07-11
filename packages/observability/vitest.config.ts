import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/observability',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
