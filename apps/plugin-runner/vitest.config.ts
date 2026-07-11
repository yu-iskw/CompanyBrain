import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/plugin-runner',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
