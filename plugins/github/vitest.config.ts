import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/plugin-github',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
