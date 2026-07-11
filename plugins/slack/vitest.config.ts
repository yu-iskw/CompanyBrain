import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/plugin-slack',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
