import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/api',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
