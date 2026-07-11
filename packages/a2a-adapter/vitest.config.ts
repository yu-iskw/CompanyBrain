import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/a2a-adapter',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
