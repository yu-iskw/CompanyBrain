import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/ranking',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
