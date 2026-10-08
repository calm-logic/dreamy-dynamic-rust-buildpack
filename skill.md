# The dynamic-rust buildpack

Projects on this buildpack are Rust applications on the shared
[dynamic-rust](https://github.com/aleontiev/dynamic-rust) framework with the
dynamic-rust-admin UI. Read this with the worker skill (`/agent/skill.md`) and
the [framework guide](guide.md).

## Understand the framework

Read the project's `README.md`, `foundation.json`, `backend/project.json`, and
existing source in your downloaded workspace before editing.

The buildpack's shared framework supplies authentication, core identity/resources, the
Dynamic REST API protocol, the admin UI, workspace branding, and release gates.
Project code supplies business-specific extensions:

| Piece | Purpose | Project location |
| --- | --- | --- |
| Models | Business records and relationships, e.g. an equipment loan | `backend/src/models/` |
| Hooks | Synchronous validation and business rules around a write | `backend/src/hooks/` |
| Tasks | Deferred work and external effects, e.g. a reminder email | `backend/src/tasks/` |
| Roles | Resource, action, and record access rules | `backend/src/roles/` |
| Config | App options and the five-layer blueprint | `backend/project.json`, `config/` |
| UI overrides | Thin project-specific configuration/components | `frontend/overrides/` |

The blueprint has exactly `models`, `hooks`, `tasks`, `roles`, and `config`.
Preserve `config.api=dynamic-rust`, `admin=dynamic-rust-admin`, `brand=dreamy`,
`database=postgres`, `compute=lambda`, and `environments=[dev,production]`.
Do not redefine the core User, Identity, IdentityVerification, Role, Dashboard,
View, or Provider models, or replace shared auth, scaffolding, or CI.

`foundation.lock.json` pins the official public `aleontiev/dynamic-rust` and
`aleontiev/dynamic-rust-admin` libraries. Existing `admin=dream-admin` revisions
remain compatible; preserve their immutable source unless changing the request.

Read [the framework guide](guide.md) when planning extensions.
It explains the registered model, hook, action, task, migration, and permission
interfaces. Use only interfaces present in the pinned `dynamic-rust` revision.
The automatic publisher compiles project code in a credential-isolated builder,
then deploys the sealed backend and composed admin UI to development. Put an
authenticated declarative smoke test in `config/e2e.json` for each business flow
that must pass after deployment. The trusted release runner executes those steps;
project source never receives repository, integration, or deployment credentials.
Steps run as the owner unless they carry `"as": "<role name>"`: the runner then
adds a temporary member holding only that role and runs the step as them, so
the deployed roles are checked too, e.g.
`{"as": "Requester", "path": "/api/admin/invoices/", "status": 403}` and
`{"as": "Finance", "path": "/api/admin/invoices/", "status": 200}`.

## Editable paths

Editable paths: `backend/project.json`,
`backend/src/models/`, `backend/src/hooks/`, `backend/src/tasks/`,
`backend/src/roles/`, `backend/tests/`, `frontend/overrides/`, and `config/`
except `config/environments.json`. Framework-maintained files are reported as
skipped and never uploaded; binary files and files over 256 KB are skipped too.

## Regenerated files

For an older workspace without the registered application host, run
`dreamy task TASK upgrade`, then `download` again. This regenerates platform-owned
Cargo, runtime-host, CI, foundation-lock, and frontend preparation files around
the editable project layers; do not hand-edit those generated files.

## Read and change data in the deployed app

The project runs as a deployed application with its own database. `app` calls
that application's admin API as the project owner, so you can inspect and fix
real data. Dreamy holds the credential and opens the session; no password,
token, or cloud key ever reaches you.

```sh
dreamy task TASK app /api/admin/users/
dreamy task TASK app /api/admin/loans/ --query 'filter{status}=overdue&sort=-due_date'
dreamy task TASK app /api/admin/loans/ID/ --method PATCH --data '{"data": {"status": "paid"}}'
dreamy task TASK app /api/admin/loans/ --method POST --data-file new-loan.json
```

Paths must start with `/api/admin/` and keep their trailing slash. `--query`
takes a query string or a JSON object. `--stage dev` is the default; pass
`--stage production` only when the request is explicitly about production data,
and read before you write — every call is recorded in the user's activity log.

This changes the app's *data*, including role records (`/api/admin/roles/`)
and the roles a user holds (`PATCH /api/admin/users/ID/` with `{"roles": [...]}`).
To change its models, hooks, tasks, or grants in code, edit the files in the
workspace as described above.

