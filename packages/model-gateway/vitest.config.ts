import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/model-gateway',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
