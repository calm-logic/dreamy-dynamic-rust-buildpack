# The dynamic-rust buildpack guide

Use this guide to place project logic in the right layer. Inspect the claimed
workspace through the API for its actual files and dependency versions.

The official MIT libraries are `aleontiev/dynamic-rust` and
`aleontiev/dynamic-rust-admin`. Their exact Git revisions are recorded in
`foundation.lock.json`, shared by the platform and exported projects.

## What the buildpack does

There are three different pieces:

- **Dreamy platform:** conversations, worker leases, editable drafts, immutable
  revisions, Git synchronization, integrations, and release orchestration. These
  endpoints do not belong inside a generated app.
- **Shared application runtime:** sign-in, app sessions, PostgreSQL access, core
  resource endpoints, admin metadata, registered project resources, transactional
  hooks/actions, durable tasks, and ordered migrations. Apps use custom magic
  links and optionally the shared Google broker; projects should not implement
  their own authentication stack.
- **Shared libraries:** `dynamic-rust` implements the Dynamic REST wire protocol
  plus the application host and extension registry. `dynamic-rust-admin` provides
  the Vue/Quasar admin shell and resource screens. Generated project code links
  the pinned runtime and registers only its business-specific extensions.

Apps share the shell, theme, and navigation conventions. Resource types vary by
app. Workspace branding supplies the company name, square icon, logotype, primary
color, and accent color. Deployment supplies API URLs and branding assets; keep
these out of project-specific hardcoded authentication or deployment code.

## Source layout

```text
backend/
  Cargo.toml                 Generated executable and pinned dependencies
  project.json               Complete five-layer blueprint
  src/main.rs                Generated application host
  src/lib.rs                 Generated extension registry and module roots
  src/models/mod.rs          Module declarations for project models
  src/hooks/mod.rs           Module declarations for project hooks
  src/tasks/mod.rs           Module declarations for project tasks
  src/roles/mod.rs           Module declarations for project permissions
  tests/                     Project-specific tests
frontend/
  scripts/prepare.py         Generated shared-admin composition tool
  overrides/                Editable UI configuration/components
config/
  environments.json         Platform-managed dev/prod locations
  limits.json               Example project-owned configuration file
foundation.json             Foundation names, core models, revision and digest
```

The backend is one generated app executable. Extend its existing modules;
keep Rust `mod.rs` declarations consistent with new files. Do not create a second
HTTP API or replace the generated `Cargo.toml`, `src/lib.rs`, frontend preparation
script, environment mapping, or CI scaffolding.

## The five layers

**Models** describe business records and relationships. For an equipment app,
`Asset` and `Loan` are project models; the borrower references the shared `User`.
Put registration code in `backend/src/models/` and the corresponding description
in the blueprint's `models` array. Register each model with
`Model::new(plural, singular)`, typed fields, required/read-only flags,
relationships, uniqueness, role grants, optional metadata, and an optional hook.
Call `registry.model(...)` from that layer's `register` function. Registered
models receive transactional PostgreSQL persistence, Dynamic REST CRUD, filtering,
pagination, and admin metadata.

Give every field a label and a description. `.label("due_date", "Due date")`
sets the column heading and form label; without one the admin falls back to the
title-cased field name, so add a label wherever that fallback reads badly (an
abbreviation, a foreign key, a unit). `.describe("due_date", "When the loan must
be returned.")` sets the help text shown beside the input and returned in the
resource's OPTIONS document — one sentence saying what the field holds and any
unit or constraint a person needs in order to fill it in correctly. These are
the only explanation a user of the deployed app ever sees, so write them for
that person, not for another developer:

```rust
Model::new("loans", "loan")
    .field("due_date", FieldKind::Date)
    .required("due_date")
    .label("due_date", "Due date")
    .describe("due_date", "When the loan must be returned.")
```

Give every model an icon with `.icon("account")` — a Material Design icon name
without the `mdi-` prefix, chosen for what the model is (`account` for people,
`cash` for loans, `package-variant` for assets). The admin shows it in the
navigation drawer, on the model's pages, and on every field of another model
that references it, so a `borrower` relation on loans carries the borrower
model's icon. Without one every model looks like a generic table.

Point at other records with `.relation("borrower", "borrowers")` for one record
and `.relations("guarantors", "borrowers")` for a list of them. The runtime
checks that every referenced record exists and is readable, refuses to delete a
record that is still referenced, and sideloads the related records on request,
so the admin shows names as links rather than ids in lists and on detail pages
(a list of links for a many-relation) and edits them with a search box. Never
model a reference as a plain `FieldKind::Uuid` field: the admin cannot follow
or name it.

Keep files — receipts, contracts, photos, signed PDFs — in file fields:
`.file("scan")`, with a label and description like any field. The admin offers
an upload area, shows the file's name and size, and downloads it; the runtime
stores it in the app's bucket where its hosting has one and in the database's
large objects otherwise, and deletes it when it is replaced or its record is
deleted. Never keep file contents in a record (base64 text, JSON blobs) or cap
uploads yourself. Code that makes a file (an export, a generated PDF) stores it
with `ctx.put_file(name, content_type, bytes).await?` and sets the returned
value with `ctx.elevated().update(...)`; mark such fields `.readonly(...)` when
people should only download them. dynamic-rust's APPLICATION.md "Files" has the
upload API.

A model that is plumbing rather than something people browse can stay out of the
admin's navigation drawer with `.metadata(json!({"section": ""}))`; it remains
routable, searchable, and linkable from relations.

**Hooks** are synchronous business rules associated with a write. For example,
reject a loan whose return date precedes its checkout date, or prevent checkout
of an unavailable asset. A failed rule prevents the write. External network
calls, long computations, and retryable side effects belong in Tasks. Implement
`Hook` with `#[handler]`; `before` and `after` receive a mutable transactional
`Context`, the operation, prior value, and proposed/current record.

**Actions** are the steps of a workflow a person takes on one record — submit,
approve, reject, send, receive. Implement `Handler`, register it with
`registry.action(model, name, roles, handler)`, and describe it with
`registry.describe_action(model, name, json!({...}))`: `label`, `icon`,
`confirm`, `when` (lookups on the record's fields — `state`, `state__in`,
`approved_at__isnull` — enforced by the runtime and used by the admin to show
the button only where it applies) and `parameters` (inputs the admin asks for
in a dialog, such as a rejection `reason` with `"required": true`). The admin
shows each action a person may run as a button on the record page and reloads
the record afterwards; return the updated record from the handler. Make
workflow fields (`state`, totals, numbers, `approved_by`) `.readonly(...)` so
nobody sets them through a form, and change them in the handler through
`ctx.elevated()` — the same transaction with the application's own authority,
which skips the person's grants, row filters and read-only fields but still
runs hooks and validation — after the handler has decided the step is allowed.
Running the action is the permission; the person need not be able to update
the record.

**Tasks** are deferred business work, such as sending an overdue reminder or
syncing a record to an accounting system. Design retries to avoid duplicate
effects and pass stable record identifiers rather than credentials in payloads.
Implement `Handler`, register it with `registry.task`, and enqueue it through
`Context::enqueue` with a stable idempotency key (the same write that triggers
it, so it is queued only if the write commits). A scheduled private function
runs every due task about once a minute. For work on a timer, such as pulling
changes from an outside service, register the task and
`registry.schedule("pull_vendors", Duration::from_secs(900))`: it runs once per
period as the app itself (`ctx.actor.is_superuser`, empty `ctx.actor.id`), so
record who or what it acted for in the data. A failed task keeps its error
message in the queue and is retried with backoff. A task holds the app's write lock only
from its first write, so call outside services before writing, and call
`ctx.lock().await?` first when a later write depends on what it read.

**Email** to people (an approval request, an invitation) is a task enqueued by
the write that causes it. Tasks get the same mail settings as sign-in email:
send from `APP_MAIL_FROM` through SendGrid with `APP_MAIL_API_KEY` when it is
set (it is in every deployed environment), otherwise through SES in
`APP_MAIL_REGION`. Never read or log the key elsewhere. An email
only goes out for writes made after the release that queues it is deployed.

**Outside services are providers.** Every service the app talks to —
QuickBooks, Xero, Uber, Google, Slack, Stripe, SendGrid, Asaak API, any other
API — is registered as an integration, which appears in the deployed app as a
record on its **Providers** page. Never put tokens, keys, client secrets or
service passwords in models, config, code, tests or the reply, and never ask the
requester how a service signs in or for its credentials: build the provider, and
the credentials arrive through it. A request such as "connect to Asaak API",
"add a QuickBooks integration" or "sync loans from Uber" is complete without
anything more from the requester; use what you know of the service's public API.

Credentials reach a provider one of two ways. The workspace may have set the
service up for every app: the claim's `workspace_providers` lists each such
integration with its name, environments and the exact `code` to register it.
When the request needs one of these services, register it with that code,
unchanged (the name must match), and do not hard-code its base URL or token:
on every deploy Dreamy writes the base URL for that environment into the app's
provider and, when its `credentials` say "injected by Dreamy", the token or
client secret too, then connects it. "Entered in each app" means the app's
administrator pastes their own token (Asaak API takes each person's own) on the
Providers page and presses Connect. Otherwise an administrator enters
everything there. Either way the code only names the service and how it signs in.

Services that issue an API token (key) use `Integration::token`. The token is
sent as `Authorization: Bearer <token>` unless `.token_header` says otherwise;
`.check(path)` is a cheap authenticated GET (one page of something the token
may read) that Connect requests before marking the provider connected:

```rust
registry.integration(
    Integration::token("ledger", "Ledger API")
        .describe("Pulls collections and pushes receipts.")
        .token_header("Authorization", "JWT {token}")
        .base_url("https://api.ledger.example")         // optional default
        .stage_base_url("dev", "https://api.ledger.dev") // optional, per stage
        .check("/v0/users/?per_page=1"),
)?;
```

Services that sign in with OAuth 2 use `Integration::oauth2`; an administrator
enters the client ID and secret, registers the redirect URI the record shows,
and presses Connect:

```rust
registry.integration(
    Integration::oauth2("quickbooks", "QuickBooks Online")
        .describe("Two-way sync of vendors, accounts, purchase orders and bills.")
        .authorize_url("https://appcenter.intuit.com/connect/oauth2")
        .token_url("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer")
        .scopes(&["com.intuit.quickbooks.accounting"])
        .account_params(&["realmId"])
        .base_url("https://quickbooks.api.intuit.com")
        .stage_base_url("dev", "https://sandbox-quickbooks.api.intuit.com"),
)?;
```

Use a connection from tasks (`ctx.http()` is the shared client for services
that need no credentials; `dynamic_rust::application::reqwest` is the library —
do not add dependencies). A path starting with `/` is requested under the
provider's base URL with its credentials:

```rust
let ledger = ctx.integration("ledger").await?;   // 409 until connected
let page: Value = ledger.get("/v0/collections/?page=1&per_page=100")
    .send().await.map_err(ApiError::internal)?
    .error_for_status().map_err(ApiError::internal)?
    .json().await.map_err(ApiError::internal)?;
// .post / .put / .patch / .delete the same way; qbo.account["realmId"] for OAuth accounts
```

`ctx.integration` answers 409 with a readable message while the service is not
connected or is turned off, so the task fails visibly and retries. Keep
non-secret choices (account mappings, default accounts, what to sync) in an
ordinary settings model.

`providers` is an ordinary built-in model, so everything about models applies
to it: roles grant its operations with conditions, its `connect` and
`disconnect` actions, and its field rules (below); its records are filtered and
listed like any other. The record the code registers carries `primary: true`.

**One connection per company, entity or person.** An integration serves the
whole app unless it says otherwise, which suits a single company. When each of
several companies, entities, branches or tenants needs its own account with a
service (its own books, its own API token), or each person their own, give the
providers model a relation to that record and register the integration
`.per` that field — the framework does the rest:

```rust
registry.extend("providers", |providers| {
    providers
        .relation("entity", "entities")
        .label("entity", "Entity")
        .describe("entity", "The entity whose books this connection reaches.")
})?;
registry.integration(Integration::oauth2("quickbooks", "QuickBooks Online") /* as above */ .per("entity"))?;

// In tasks and hooks: this entity's books, never another's (409 until connected).
let qbo = ctx.integration_for("quickbooks", entity_id).await?;
// From the entities hook on create, so a new entity only needs Connect:
ctx.add_connection("quickbooks", entity_id).await?;
```

Each entity's connection is a `providers` record naming it in that field;
administrators add one under Providers (choose the service and the entity) or
code adds it with `add_connection`, and each is connected on its own (OAuth
connections reuse the client ID and secret on the primary provider; token
connections take their own token). The primary provider may itself name an
entity, so an app that already had one connection keeps it as the first
entity's: set its `entity` in a migration or ask nothing and let an
administrator choose it. An entity's account details (company id) come back in
the connection's `account`. Use a workspace provider's code unchanged and add
`.per(...)` to it when the request needs one connection per record. For a
person's own account relate providers to `users` (`.relation("user", "users")`
and `.per("user")`) and give the role that may connect its own
`{"providers": {"list": {"user": "$user.id"}, "read": {"user": "$user.id"},
"create": {"user": "$user.id"}, "update": {"user": "$user.id"},
"connect": {"user": "$user.id"}, "disconnect": {"user": "$user.id"}}}`;
reach it with `ctx.integration_for("asaak_api", user_id)`.

**Keeping records in step.** A model whose records are synced with a service
declares `.external_id()`: a read-only, unique `external_id` holding each
record's id in that service, shown to people but set only by sync code. Pull
with `ctx.upsert_external("collections", &remote_id, json!({...}))`, which
updates the record with that `external_id` or creates it, as the app, so pulling
twice never duplicates; schedule pulls with `registry.schedule`. Push by
creating the record in the service from a task the write enqueued, then
`ctx.elevated().update(kind, id, json!({"external_id": remote_id}))`; a record
that already has an `external_id` is updated there instead of created again.
Record each sync's outcome (status, error, time) on the records it touches.

**Dynamic REST APIs** (Asaak API is one; Dreamy's own API follows the same
conventions): resources live at `<base>/<version>/<plural>/`, for Asaak API
`/v0/<plural>/`, and sign in with a token in a header — Asaak API takes
`Authorization: JWT <token>` (as the workspace provider's code says).
- List: `GET /v0/loans/?page=1&per_page=100` answers
  `{"loans": [...], "meta": {"page", "per_page", "total_results", "total_pages"}}`;
  read `meta.total_pages` to page through everything.
- Filter: `filter{field}=value`, with operators `filter{field.in}=a&filter{field.in}=b`,
  `.gt/.gte/.lt/.lte`, `.icontains`, `.isnull`, and `filter{-field}=value` to
  exclude; related fields as `filter{borrower.name.icontains}=...`. Pull changes
  incrementally with `filter{updated.gte}=<last pull>` and `sort[]=updated`.
- Sort: `sort[]=-created`. Fields: `include[]=borrower.` sideloads a relation
  (its records arrive in their own top-level list, keyed by plural name),
  `exclude[]=notes` drops one, `include[]=*` adds deferred fields.
- One record: `GET /v0/loans/<id>/` answers `{"loan": {...}}`; create with
  `POST /v0/loans/` and change with `PATCH /v0/loans/<id>/`, sending the
  fields as JSON; `DELETE` removes. `OPTIONS /v0/loans/` describes the fields.
- Errors are JSON keyed by field (`{"amount": ["..."]}`) or `{"detail": "..."}`.
Map each remote record's `id` to `external_id` locally.

**Roles** define app-specific access, such as a clerk recording loans and a
manager viewing all loans. Grant list/read/create/update/delete operations on
each registered model and use row filters for ownership rules. The runtime
enforces these grants on CRUD and inside `Context`; hiding a UI button is
insufficient. Keep app roles separate from platform owner/editor/viewer and
worker-key permissions.

Roles exist in two forms that combine. Grants in code (`.grant("clerk", &[...])`
and `role_filters`) name a role; a role *record* in the deployed app's **Roles**
resource has a `name` and a `permissions` access map, grouped by resource and
operation, where each rule is `true`, `false`, or a condition on the records:
field lookups that must all hold (`{"owner": "$user.id"}`), grouped with
`$or`, `$and` and `$not`. A lookup is a field name plus an optional operator —
`exact` (default), `in` (list), `icontains`, `gt`, `gte`, `lt`, `lte`,
`isnull` (boolean); numbers compare numerically, other fields as text:

```json
{"loans": {"list": true, "read": true, "create": true,
           "update": {"$or": [{"owner": "$user.id"},
                              {"status__in": ["draft", "review"], "amount__lte": 500}]}},
 "users": {"list": true, "read": true}}
```

A role's map may also grant the model's registered **actions**, next to its
operations, as `true` or as a condition on the record — so who may approve
which orders is data an administrator can change:

```json
{"purchase_orders": {"list": {"requester": "$user.id"}, "read": {"requester": "$user.id"},
                     "approve": {"approver": "$user.id", "state": "submitted"}}}
```

Users hold role records by id in their `roles` field. On every request the app
loads the held roles, adds each role's name to the user (so code grants for
that name apply too) and merges the map into the resources it names with union
semantics: any role that grants an operation grants it, conditions are OR-ed.

A role's rules for a model may also say which fields it sees and changes, next
to its operations: `"fields": {"salary": {"write_only": false}, "status":
{"read_only": false}, "notes": {"write_only": true}}` — `write_only: false`
reveals a field the code hides (`.write_only("salary")`), `read_only: false`
lets the role change one the code makes read-only, and `true` takes either
away. Across the roles a person holds, a field is visible when any of them may
see it and changeable when any may change it. Administrators set these on the
Roles page; ship them in `registry.role` maps when the design calls for them.
Role names match code grants exactly, case included: a record named `Approver`
does not receive `.grant("approver", ...)`. A model with no grants in code is
open to every signed-in user, so declare grants for every model. Built-in
resources (users, roles) accept only `true`/`false` rules; a role granting
`roles` and `users` operations lets its holders manage roles and assign them in
the admin's Roles and Users pages. `providers` is a model: a role granting its
`update` and its `connect` action lets its holders set up and connect
integrations, on every provider or, with a condition, on some.

**Several companies or entities in one app.** Build it in the project's own
code; the framework has what it needs. Add an entity model and an `entity`
relation on every model whose records belong to one, and keep each person's
access per entity in role records whose rules carry the entity as a condition
(`{"expenses": {"list": {"entity": "<entity id>"}, ...}}`): an app's hook can
create an entity's roles (its Admin, Finance, Employee, ...) when the entity is
created, from templates in code, and assigning a person a role per entity gives
them different access in each. The runtime enforces those conditions in the API,
so data stays apart without trusting the browser. A switcher in the frontend
filters by the chosen entity; totals stay per currency unless converted. Give
services an account per entity with `.per("entity")` above. Managing people and
roles stays with app-wide administrators (users and roles take only
`true`/`false`); let entity administrators assign people within their entity
through an ordinary membership model the hook turns into role assignments.

How grants are evaluated: a signed-in user's roles are the names of the role
records they hold (legacy string entries in `roles` are taken as names) plus
the implicit role `authenticated`; `*` matches anonymous requests. Signing in
is invitation-only: only the owners (superusers) and the people an
administrator added on the admin's Users page can sign in, by email link or
Google, and signing in never creates an account, so `authenticated` means
every member of the app and never the public. Holding a role is what makes a member: a signed-in person with no role
carries no `authenticated` role either and reaches nothing — the admin shows
them a page saying to ask an administrator for a role — and built-in
resources (users, roles, providers, identities) show only to roles whose maps
grant them. Grant `authenticated` what every member may do; name the app's
own roles for anything narrower; never grant `*` unless the request asks for
anonymous access. Administrators (the Admin role,
or a role granting `users` operations) add people with a name, email and
roles, and remove them.

Ship the app's roles with `registry.role("Approver", json!({...}))` in the
roles layer rather than inserting role records with SQL: the runtime checks
each map against the registered models, fields and actions when it migrates
(so a wrong field or action fails the tests instead of silently granting
nothing), creates the role once, and updates it in later releases only while
nobody has changed it in the admin.

Every app starts with a default **Admin** role granting every operation on
every resource (roles, users' roles, providers, dashboards and views included)
and every action. It is an ordinary role record: it follows the app's new
models and actions while untouched, and administrators may narrow, rename or
delete it like any other. Ship `registry.role("Admin", json!({...}))` only to
give Admin a different map. Apart from Admin a new app has no roles: decide
which roles the app needs from what its people do (a clerk, a manager, an
approver, ...), ship each with `registry.role`, and grant them in code too when
the rule is part of the app's design; when users should be able to adjust the
rules, keep them in role records the owner edits in the admin. Administrators
can rename roles, so prefer grants and role maps to checking a role's name in
code. The Dreamy project owners are superusers of every deployed environment:
their access — and Dreamy's when it changes the app's data for them — never
depends on roles, since they pass every grant, row filter, action rule and
field rule, and they are given the Admin role on first sign-in when it exists.
Say in the reply which roles exist and what each may do.

**Config** holds application options and the blueprint's buildpack choices.
Keep credentials in integrations (Providers), never in config files, models or code. The
platform owns environment URLs, workspace branding, and infrastructure settings.

The minimum blueprint shape is:

```json
{
  "models": [],
  "hooks": [],
  "tasks": [],
  "roles": [],
  "config": {
    "name": "Equipment Checkout",
    "url": null,
    "api": "dynamic-rust",
    "admin": "dynamic-rust-admin",
    "brand": "dreamy",
    "database": "postgres",
    "database_strategy": "shared_instance_logical_database",
    "compute": "lambda",
    "environments": ["dev", "production"]
  }
}
```

Preserve existing config keys when editing. Models must have a `name` and cannot
reuse a core model name. The blueprint describes the app; Rust registration is
the executable contract and must agree with it. Register append-only SQL through
`registry.migration(name, sql)` when the generic record store is insufficient.
Applied migration names and digests are immutable.

## Publishing and deployment checks

Successful completion freezes one revision and queues its repository commit and
development release. The isolated builder compiles and tests the generated app,
builds the pinned admin UI, verifies a static Lambda executable, and seals file
digests against the exact committed snapshot. It runs
`cargo test --manifest-path backend/Cargo.toml -- --include-ignored` with
`DREAM_TEST_DATABASE_URL` naming a fresh PostgreSQL server (superuser), exactly as
the agent's own test run does: database tests read that variable, give each test
its own schema or database, and fail when it is missing. The trusted deployer separately
bootstraps the database, deploys the artifact, signs in through the real app, and
runs core checks plus `config/e2e.json` (steps with `"as": "<role>"` run as a
temporary member holding only that role, which is how to check each role's
access against the deployed app: what it may list and do, and that forbidden
requests answer 403). A failed build or scenario leaves the
source revision intact and records a visible release failure.

The core checks sign in, load the landing page, then use the shared shell on the
Users screen (`/users/`): its account menu, light/dark switch, workspace logo in the
drawer, and sign-out, and open the Roles (`/roles/`) and Providers (`/providers/`)
pages. Every app has these three: a frontend override may give the app its own
landing page or full-page workspace (`router.addRoute(...)` and a `home`
redirect), but must keep the shared shell routes working and, when it draws its
own navigation, keep links to Users, Roles and Providers for the people allowed
to manage them.

### Release scenarios (`config/e2e.json`)

Every release runs the project's `config/e2e.json` against the deployed app —
on dev for every release, and on production too when it is published — after
the core checks. It is declarative JSON, not a script:

```json
{
  "steps": [
    {"method": "POST", "path": "/api/admin/suppliers/", "body": {"name": "Release check supplier"},
     "status": 201, "save": "supplier"},
    {"path": "/api/admin/suppliers/{{supplier.supplier.id}}/", "status": 200,
     "expect": [{"path": "supplier.name", "value": "Release check supplier"}]},
    {"as": "Requester", "path": "/api/admin/suppliers/", "status": 200},
    {"as": "Requester", "path": "/api/admin/invoices/", "status": 403},
    {"as": "Requester", "method": "POST", "path": "/api/admin/suppliers/", "body": {"name": "x"}, "status": 403}
  ],
  "cleanup": [
    {"method": "DELETE", "path": "/api/admin/suppliers/{{supplier.supplier.id}}/", "status": 204}
  ]
}
```

- Each step is `method` (default `GET`; `POST`, `PATCH`, `PUT`, `DELETE`,
  `OPTIONS`), `path` (must start with `/api/admin/`), optional `body`, and the
  expected `status`. Up to 50 `steps` and 50 `cleanup` steps.
- `save` keeps the response JSON under a name; later steps use
  `{{name.path.to.value}}` anywhere in `path` or `body` (a value that is the
  whole string keeps its JSON type). `expect` is a list of `{"path", "value"}`
  the response must equal.
- Steps run as the owner, a superuser holding the Admin role. A step with
  `"as": "<role name>"` runs as a temporary member holding only that stored
  role — the way to check each role's access in the deployed app: what it may
  list, read and press, and that forbidden requests answer 403. The role must
  exist in the app (ship it with `registry.role`).
- Any step that writes needs `cleanup` steps; cleanup always runs, even after a
  failure. The scenarios also run in production when the app is published, so
  only create records the cleanup removes, and never touch real data.
- A failing step fails the release and names the role, method, path and the
  expectation that did not hold.
- Every step is a test on the project's **Tests** tab, next to the core
  release checks, with its latest status. Give each step a `title` (up to 120
  characters, e.g. `"Requesters cannot see invoices"`) and a one-sentence
  `description` of what it proves for the people reading that tab; without
  them the tab derives both from the method, path, role and status.

Each app has its own logical database and role on the shared dev/prod PostgreSQL
instances. The deployment runner supplies those connections, runs the required
gates, and promotes the same artifact after dev E2E. A project worker does not
receive infrastructure credentials or make direct database/Git/deployment edits.
