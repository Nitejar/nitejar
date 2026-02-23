/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['./base.js', 'next/core-web-vitals'],
  parserOptions: {
    project: true,
  },
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
  },
}
