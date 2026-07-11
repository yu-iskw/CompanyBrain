import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/worker',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
