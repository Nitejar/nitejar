# Task ID: 150

**Title:** Create MCP server package structure

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Set up the packages/mcp-server package with basic structure, dependencies, and build configuration.

**Details:**

1. Create `packages/mcp-server/` directory structure:
   ```
   packages/mcp-server/
   ├── src/
   │   ├── index.ts           # Entry point & CLI
   │   ├── server.ts          # MCP server setup
   │   ├── auth/
   │   │   ├── index.ts
   │   │   ├── token.ts       # API token validation
   │   │   └── context.ts     # Auth context for tools
   │   ├── tools/
   │   │   ├── index.ts       # Tool registry
   │   │   ├── auth.ts        # auth_* tools
   │   │   └── agents.ts      # agent_* tools
   │   └── types.ts
   ├── package.json
   ├── tsconfig.json
   └── README.md
   ```
2. Create package.json with:
   - name: @nitejar/mcp-server
   - bin: { nitejar-mcp: './dist/index.js' }
   - dependencies: @modelcontextprotocol/sdk, @nitejar/database, bcrypt
3. Create tsconfig.json extending workspace config
4. Add package to pnpm-workspace.yaml
5. Create basic server.ts with MCP SDK setup

**Test Strategy:**

1. Run `pnpm install` to link package
2. Run `pnpm typecheck` for type errors
3. Run `pnpm --filter @nitejar/mcp-server build` compiles
4. Verify bin script is executable
