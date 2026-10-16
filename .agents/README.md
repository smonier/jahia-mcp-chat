# jahia-mcp-chat agent harness

Project knowledge for AI agents working on this module. Generic Jahia knowledge (OSGi, CSRF guard, UI
extensions) lives in AIStartupKit, the sole reference: read its `CLAUDE.md` and the skills
`jahia-osgi-ui-extension`, `jahia-java-osgi`, `jahia-java-security`, `jahia-dev-osgi-module`.

Module type: **OSGi UI extension** (Track 2): React 18 + Webpack Module Federation in jContent, Java servlets
behind it. Not a JS template set: the generated `CLAUDE.md` and `.claude/` of this repository describe the JS
track and do not apply.

| File | Read it when |
|---|---|
| [context/architecture.md](context/architecture.md) | Before any change: components, endpoints, MCP servers, sign-in flow, where data lives |
| [context/decisions.md](context/decisions.md) | Before changing configuration, security or storage: what was decided and why |
| [skills/build-deploy/SKILL.md](skills/build-deploy/SKILL.md) | To build, deploy and check the module on a local Jahia |

Every change updates `CHANGELOG.md` (Unreleased) and the README in the same commit.
