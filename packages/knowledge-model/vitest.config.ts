import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/knowledge-model',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
