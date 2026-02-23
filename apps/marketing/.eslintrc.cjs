module.exports = {
  root: true,
  extends: ['@nitejar/eslint-config/next'],
  overrides: [
    {
      files: ['next-env.d.ts'],
      rules: {
        '@typescript-eslint/triple-slash-reference': 'off',
      },
    },
  ],
}
