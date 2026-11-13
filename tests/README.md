# jahia-mcp-chat end-to-end tests

Cypress 13 with `@jahia/cypress`, run against a running Jahia that has mcp-server, genai-connector (installed; it
is stubbed in the drawer specs, so it needs no model) and the jahia-mcp-chat build under test.

| Spec | What it proves |
|---|---|
| `api.spec.ts` | The module's servlets: visitors refused, the CSRF guard's token required on every route, the configuration the browser reads never carries a server's URL or credential, servers offered per site and only on sites the user has jContent access to, attachments kept for their sender, sign-in not started for a site out of reach |
| `drawer.spec.ts` | The drawer in jContent as an editor: docked beside the page and gone on Escape, the not-ready banner without genai-connector, tiers and servers in Settings, Markdown answers (a fenced answer included), tool calls and an approval answered with Deny, and an axe WCAG 2.1 AA check of the chat and the Settings tab |

The drawer specs stub genai-connector's status and its agent stream (`cy.intercept`, or a stream played inside the
page for the approval test, which must stay open until the editor answers), so a conversation is the same on
every run. The module's own servlets are real.

## Run

Node 20.19+ (22 recommended):

```bash
cd tests
yarn install
JAHIA_URL=http://localhost:8080 SUPER_USER_PASSWORD=root1234 CYPRESS_MC_TEMPLATE_SET=classic-templates yarn e2e:ci
```

`CYPRESS_MC_TEMPLATE_SET` is any template set installed on the instance that creates a home page (default
`dx-base-demo-templates`). `yarn e2e:debug` opens the Cypress runner; `yarn typecheck` checks the specs.

## What a run leaves behind

The specs create the sites `mc-api-allowed`, `mc-api-other` and `mc-drawer` and the users `mc-api-*` and
`mc-drawer-editor`, and delete them at the end. The remote MCP server they need is a factory configuration
instance, `org.jahia.se.modules.mcpchat.server-cyremote.cfg`: the provisioning API can write an instance but not
delete one, so the run leaves it switched off (`enabled=false`). Delete the file from `karaf/etc` if you want it
gone.

Every test signs out at the end: an open session holds a licence seat.

## Notes

- Jahia answers a visitor's 401 from a servlet with its sign-in page, under 401, 400 or a 302 depending on the
  session the request carries: `assertSignInRequired` checks that nothing of the module came back, not one code.
- The chat button is a jContent header action; below about 1000 px jContent folds it into its Actions menu, hence
  the 1440 x 900 viewport.
- Moonstone's filled accent and danger buttons are left out of the contrast check (Jahia's own colours, 2.9:1),
  as in the other Jahia modules; nothing else is.
