module.exports = {
  root: true,
  extends: ['@nitejar/eslint-config/next'],
  overrides: [
    {
      files: ['scripts/**/*.mjs'],
      rules: {
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
    {
      files: ['next-env.d.ts'],
      rules: {
        '@typescript-eslint/triple-slash-reference': 'off',
      },
    },
    {
      files: ['app/admin/**/*Client.tsx'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      },
    },
  ],
}
