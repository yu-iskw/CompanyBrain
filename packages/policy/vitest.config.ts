import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/policy',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
