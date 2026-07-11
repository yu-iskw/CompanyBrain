import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/retrieval',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
