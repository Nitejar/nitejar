# Task ID: 156

**Title:** Create MCP server CLI and configuration

**Status:** pending

**Dependencies:** 153 ✓, 154 ✓, 155 ✓

**Priority:** high

**Description:** Finalize MCP server entry point, CLI interface, and document configuration for Claude Code.

**Details:**

1. Complete `packages/mcp-server/src/index.ts` CLI entry:
   - Parse environment variables: SLOPBOT_URL, MCP_DATABASE_PATH
   - Initialize database connection
   - Start MCP server on stdio transport
   - Handle graceful shutdown
2. Add shebang and make executable
3. Create README.md with:
   - Installation instructions (npx @nitejar/mcp-server)
   - Configuration for Claude Code (.mcp.json example)
   - Available tools documentation
   - Authentication flow explanation
4. Update root package.json build scripts if needed
5. Test with Claude Code local config:
   ```json
   {
     "mcpServers": {
       "nitejar": {
         "command": "pnpm",
         "args": ["--filter", "@nitejar/mcp-server", "start"],
         "cwd": "/path/to/nitejar"
       }
     }
   }
   ```

**Test Strategy:**

1. Run MCP server directly - verify starts without error
2. Configure in Claude Code .mcp.json
3. Restart Claude Code - verify MCP connects
4. Test full auth flow: auth_login -> auth_set_token -> list_agents
5. Test agent updates work end-to-end
