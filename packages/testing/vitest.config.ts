import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/testing',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
