import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/plugin-bigquery',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
