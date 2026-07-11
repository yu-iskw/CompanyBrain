import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/provenance',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
