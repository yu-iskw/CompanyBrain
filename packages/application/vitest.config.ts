import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/application',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
