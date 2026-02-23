/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['./library.js'],
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
  },
}
