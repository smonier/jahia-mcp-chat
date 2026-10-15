---
name: jahia-cms
description: >
  Author, manage, and publish content on a Jahia CMS instance through the Jahia
  MCP server. Use when the user wants to create sites or pages, add or edit
  content nodes, upload media, search or translate content, or publish/unpublish
  content on Jahia. Covers site and page discovery, JCR node CRUD, content types,
  media upload, publication, and workflow tools.
---

# Jahia CMS (MCP server)

This skill documents the tools exposed by the Jahia MCP server. Jahia stores all
content in a JCR (Java Content Repository) tree. Nodes live at absolute paths
like `/sites/<siteKey>/home/...` and each node also has a UUID. Most tools accept
either a `path` or a `uuid` to identify a node.

Two workspaces exist: **EDIT** (draft) and **LIVE** (published). Creating and
editing content happens in EDIT. Content becomes public only after a separate
**publication** step.

Internationalized (i18n) properties are per-locale. Many tools require a `locale`
(BCP-47 like `en`, `en-US`, or Java form like `fr_FR`). Discover a site's
available languages with `site.get` → `languages`.

> Note: this file describes the tools as reported by the server's tool list. Tool
> names, parameters, and behavior may change between Jahia versions — verify
> against the live server if something does not match.

## Recommended discovery workflow

Because content types, templates, and allowed child types are site- and
page-specific, discover before you create. A typical authoring flow:

1. `site.list` → find valid `siteKey` values.
2. `site.get` → site identity, languages, homepage path.
3. `page.templates` → valid `templateName` values before `page.create`.
4. `page.create` → make an empty page.
5. `page.structure` → discover areas/containers on the page and which node types
   each accepts.
6. `site.types` / `content.type` → mandatory/optional properties and choicelist
   values for the types you intend to create.
7. `content.create` → create the content (optionally with children, atomically).
8. `publication.status` → check readiness, then `publication.publish`.

## Identifying nodes

- `path`: absolute JCR path, must start with `/` (e.g. `/sites/luxe/home/main/hero`).
- `uuid`: node identifier, standard UUID format.
- Where both are accepted, supply one. Some tools require at least one of the two.

---

## Site tools

**`site.list`** *(read-only)* — List all non-system Jahia sites on the instance.
Returns `siteKey`, title, available languages, and default language. No
parameters. Use this first to discover valid `siteKey` values.

**`site.get`** *(read-only)* — Detailed metadata for one site. Required: `siteKey`.
Returns site identity, languages, server names, homepage path, and readable raw
properties.

**`site.create`** — Create a Jahia site from a template set. Required: `siteKey`
(URL-safe: letters, digits, dash, underscore), `templateSet` (module ID). Optional:
`title`, `locale` (default `en`), `description`, `serverName` (default
`localhost`), `serverNameAliases`, `modulesToDeploy`. Call `site.template_sets`
first to discover valid `templateSet` IDs.

**`site.template_sets`** *(read-only)* — List installed non-system template sets
available for site creation. No parameters. Use before `site.create`.

**`site.types`** *(read-only)* — List content types available on a site, filtered
by installed modules and grouped by editor category. Required: `siteKey`. Optional:
`locale`. Returns i18n labels, mandatory and optional properties, and constraints.
Use for site-level type discovery.

---

## Page tools

**`page.templates`** *(read-only)* — List page (or content) templates a
contributor may pick, mirroring the editor's template picker. Required: `siteKey`.
Optional: `templateType` (`jnt:pageTemplate` default, or `jnt:contentTemplate`
for in-page content layouts), `forNodeType` (default `jnt:page`), `locale`.
Returns i18n labels, descriptions, `applyOn` constraints, thumbnails, and the
site default. Call before `page.create`.

**`page.create`** — Create an empty page (`jnt:page`). Required: `parentPath`
(e.g. `/sites/<siteKey>/home`), `name` (technical node name), `title` (i18n),
`templateName`, `locale`. Returns the new path and identifier, plus
`containersCount` / `containers` so follow-up content tools can target valid
containers without an extra round-trip. The page is created but **not published**.

**`page.list`** *(read-only)* — List a site's pages with lightweight metadata.
Required: `siteKey`, `locale`. Optional filters: `templateName`, `titleContains`,
`createdAfter`, `modifiedAfter`. Ordering: `sortBy` (`lastModified` default,
`created`, `title`, `path`), `order`. Pagination: `limit` (1–100, default 20),
`offset`.

**`page.structure`** *(read-only)* — Render a page in edit mode and extract its
container structure for authoring: template-defined areas, author-created lists,
and content nodes that accept sub-content, with their allowed types, existing
children, and nesting hierarchy. Accepts `path` or `uuid`. Use this **before
creating content** to know exactly where and what can be created.

**`page.preview`** *(read-only)* — Render a page as HTML using the authenticated
user's rendering context (server-side edit-workspace render, not a public GET).
Accepts `path` or `uuid`. Required: `locale`. Useful for visual/layout inspection.

---

## Content tools

Content nodes are the building blocks placed inside pages, folders, and lists.

**`content.get`** *(read-only)* — Get a node by `path` or `uuid` with core
metadata and all readable properties. Required: `locale`. Inspect existing content
before deciding to create, update, or reference it.

**`content.list`** *(read-only)* — List direct children of a parent. Required:
`parentPath`, `locale`. Optional: `childNodeType` filter (matches subtypes),
`projectProperties` (technical property names to include per child), `limit`
(1–100, default 20), `offset`. Returns lightweight metadata (path, type, kind,
title, childCount).

**`content.search`** *(read-only)* — Structured query builder over JCR-SQL2.
Required: `siteKey`, `nodeType`, `locale`. Optional: `basePath` (subtree scope,
must be under the site), `fullText` (mapped to `CONTAINS(n.*, ...)`; supports
phrases, `OR`, `-exclusion`, wildcards), `fullTextField` (scope full-text to one
property), `properties` (array of filters combined with AND, each with `name`,
`op` ∈ `eq|like|gt|gte|lt|lte|isNull|isNotNull`, and `value`),
`projectProperties`, `sortBy` (default `jcr:lastModified`; use `_score` with
full-text), `order`, `limit` (1–100), `offset`.

**`content.type`** *(read-only)* — Detailed definitions for one or more JCR node
types from the global type registry. Required: `nodeType` (string or array).
Optional: `includeSubTypes` (default false), `locale`, `limit` (1–100). Returns
property definitions, supertypes, module, mixin/abstract flags, and optional
subtype expansion. Use for detailed type definitions after `site.types`.

**`content.create`** — Create a content node under a page area, page, folder, or
content node. Required: `parentPath`, `nodeType`, `locale`. Optional: `name`
(auto-derived from title if omitted; letters, digits, dash, underscore),
`properties` (map of name → string or array of strings; dates ISO-8601;
REFERENCE/WEAKREFERENCE accept a UUID or path), and `children` (nested nodes
created atomically in one save, max depth 5 — useful for list items, grid cells,
or composed content like article + paragraphs). The parent must allow the
requested child type. Discover allowed types via `page.structure` and property
details via `site.types` / `content.type` first. The node graph is created but
**not published**.

**`content.update`** — Update an existing node by `path` or `uuid`. Required:
`locale`. Optional: `properties` (set/overwrite), `removeProperties` (explicit
removal), `addMixins`, `removeMixins`. All applied in one atomic save. Does **not**
rename or move nodes.

**`content.translate`** — Write i18n properties to a specific locale while
preserving non-i18n properties. Requires `path` or `uuid`, plus `locale` and
`properties`. Non-i18n and unknown fields are skipped and reported — safe for
translation workflows.

**`content.copy`** — Deep-copy a source node under a destination parent. Required:
`destParentPath`. Identify source via `sourcePath` or `sourceUuid`. Optional:
`destName` (defaults to source name), `skipChildTypes` (child node types to skip
during copy).

**`content.move`** — Move a node under a destination parent. Required:
`destParentPath`. Identify node via `path` or `uuid`. Optional: `destName`,
`renameOnConflict` (default false — auto-generate a name if a sibling exists).

**`content.rename`** — Rename a node in place (no move). Required: `newName`.
Identify via `path` or `uuid`.

**`content.reorder`** — Reorder direct children under a parent. Required:
`parentPath`, `names` (ordered, unique child names). Optional: `position`
(`FIRST`, `INPLACE` default, or `LAST`).

**`content.delete`** *(destructive)* — Hard-delete a node by `path` or `uuid`.
**Only draft-only (not yet published) content** can be hard-deleted; blocked if
already published in LIVE.

**`content.mark_for_deletion`** — Soft-delete: mark a node and its subnodes for
deletion, with an optional `comment`. Identify via `path` or `uuid`. Reversible
with `content.unmark_for_deletion`.

**`content.unmark_for_deletion`** — Remove soft-delete markers from a node by
`path` or `uuid`, restoring content previously marked for deletion.

---

## Media tools

Two upload paths: from a remote URL, or out-of-band binary upload via a signed
ticket. Files land under `/sites/<siteKey>/files`.

**`media.upload.url`** — Upload media by fetching a remote `sourceUrl` (http/https)
and streaming it into the site. Required: `siteKey`, `sourceUrl`, `fileName`.
Optional: `folder`, `mimeType`. Returns file path, identifier, mime type, and size.
Use when the media is already reachable at a URL.

**`media.upload.create`** — Create a signed one-time upload ticket for out-of-band
binary upload. Required: `siteKey`, `fileName`, `sizeBytes` (max 26,214,400 =
25 MB). Optional: `folder`, `mimeType`. Returns an `uploadUrl` — PUT the bytes to
it, then call `media.upload.finalize`.

**`media.upload.finalize`** — Finalize a ticket upload and commit the file under
`/sites/<siteKey>/files`. Required: `token` (from `media.upload.create`).

---

## Publication tools

Publication promotes content from EDIT to LIVE. Direct publish may be blocked by
workflow policy, in which case a review workflow is started.

**`publication.status`** *(read-only)* — Aggregated publication status for a node
by `path` or `uuid`. Required: `language`. Optional: `subNodes` (aggregate
descendants), `references` (include referenced content). Answers "is this
branch/page ready to publish?" including lock/WIP flags and whether a workflow is
required for the calling user.

**`publication.publish`** — Publish a node from EDIT to LIVE. Requires `path` or
`uuid`, plus `languages` (e.g. `["en"]` or `["en","fr"]`). Optional:
`includeSubTree` (default false), `mode` (`auto` default — direct when allowed,
otherwise start workflow; also `direct` or `workflow`), `comment` (used when a
workflow is started).

**`publication.unpublish`** *(destructive)* — Remove content from LIVE while
keeping the EDIT draft. Requires `path` or `uuid`, plus `languages`. Optional:
`includeSubTree`. Useful for emergency rollback.

---

## Workflow tools

When publication requires review, tasks are assigned to reviewers.

**`workflow.tasks`** *(read-only)* — List active workflow tasks assigned to the
authenticated user, with available actions and task-linked node metadata.
Optional: `offset`, `limit` (1–100, default 20).

**`workflow.complete`** — Complete an active workflow task. Required: `taskId`
(from `workflow.tasks`), `action` (must be one of that task's `availableActions`).
Optional: `comment`.

---

## Scheduler tools

**`scheduler.jobs`** *(read-only)* — List scheduler jobs, useful for polling
long-running operations such as publication jobs. Optional: `group` (Quartz job
group, e.g. `PublicationJob`), `includeStatuses` / `excludeStatuses` (from
`ADDED`, `SCHEDULED`, `EXECUTING`, `SUCCESSFUL`, `FAILED`, `CANCELED`), `offset`,
`limit` (1–100, default 20).

---

## Debug tools

**`debug.noop`** *(read-only)* — No-op debug tool. Takes no input, performs no
mutation, returns an empty payload. Useful for connectivity checks.

---

## Practical notes

- **Discover before you create.** Allowed child types and required properties
  vary per page/container and per site. Skipping `page.structure` and
  `site.types` / `content.type` commonly causes create failures.
- **Locales matter.** i18n properties are written per-locale. Use `content.translate`
  to add another language without touching non-i18n fields.
- **Nothing is public until published.** `content.create` / `content.update` only
  affect EDIT. Run `publication.status` then `publication.publish` to go live.
- **Deletion has two modes.** `content.delete` is a hard delete limited to
  draft-only content; `content.mark_for_deletion` is reversible and works as an
  editorial soft-delete.
- **Atomic composed content.** Pass `children` to `content.create` to build a
  parent plus nested items (lists, grids, article + paragraphs) in a single
  transaction (max depth 5).
