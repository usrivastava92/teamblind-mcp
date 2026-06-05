# Development Notes

This file is reserved for developer-focused details (architecture, crypto internals, local debugging, and contribution workflow).

For end-user setup and MCP client configuration, use [README.md](README.md).

## NPX In Repo Checkout

Running `npx @usrivastava92/teamblind-mcp ...` from inside this repository can fail with `sh: teamblind-mcp: command not found`.

Why:

- Outside the repo, `npx` resolves and runs the published package normally.
- Inside the repo, npm detects the current workspace package and treats it specially instead of doing a normal registry execution.
- In that mode, the package bin is not resolved the same way, so `teamblind-mcp` may not be found.

Use these commands during local development:

```bash
yarn login
./dist/index.js --login
```

This is a local dev-loop quirk only. The user-facing README should continue to recommend `npx @usrivastava92/teamblind-mcp ...` for normal consumer usage outside a source checkout.
