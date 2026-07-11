import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/domain',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
