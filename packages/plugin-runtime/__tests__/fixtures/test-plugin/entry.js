const handler = {
  type: 'test-echo',
  displayName: 'Test Echo',
  description: 'Test fixture handler for plugin runtime unit tests',
  icon: 'plug',
  category: 'custom',
  sensitiveFields: [],
  validateConfig() {
    return { valid: true }
  },
  async parseWebhook() {
    return { matched: false }
  },
  async postResponse() {
    return { success: true }
  },
}

export default { handler }
