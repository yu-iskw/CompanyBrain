import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/audit',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
