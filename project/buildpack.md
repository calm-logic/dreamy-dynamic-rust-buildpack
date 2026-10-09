# How this repository is built

This file is maintained by the dynamic-rust buildpack and refreshed with it; the
app itself is described in [README.md](../README.md).

This repository contains one Dreamy project's backend extensions and frontend
wrapper. Both sides are versioned, tested and released together.

```
backend/
  Cargo.toml           Generated app executable and pinned runtime
  project.json         Complete Models / Hooks / Tasks / Roles / Config spec
  src/models/          Project-specific data types
  src/hooks/           Synchronous pre/post-save business logic
  src/tasks/           Asynchronous business logic
  src/roles/           Project permissions
frontend/
  scripts/prepare.py   Composes the shared Dreamy Admin with local overrides
  overrides/          Project UI configuration and optional thin wrappers
config/
  environments.json   Separate dev and production configuration
foundation.json        Shared foundation and immutable Dreamy revision reference
foundation.lock.json   Official library repositories and immutable Git revisions
tools/foundation.py    Fetches and verifies the pinned frontend library
.github/workflows/check.yml  Backend and frontend checks against pinned libraries
```

The official libraries are [dynamic-rust](https://github.com/aleontiev/dynamic-rust)
and [dynamic-rust-admin](https://github.com/aleontiev/dynamic-rust-admin), both MIT.
`foundation.lock.json` records their exact revisions. Cargo fetches the Rust library;
frontend preparation fetches and verifies the admin library in `.foundation/`.
Git and network access are required on the first build.
Build and test the app with
`DREAM_TEST_DATABASE_URL=postgres://… cargo test --manifest-path backend/Cargo.toml -- --include-ignored`,
pointing the variable at a disposable PostgreSQL server for the database tests.
Compose the frontend with `python3 frontend/scripts/prepare.py`; install/build
inside `frontend/.work/admin` using the shared admin's yarn lockfile.

The generated host in `backend/src/main.rs` links the shared application runtime.
Project `register` functions add models, hooks, actions, durable tasks, roles, and
ordered migrations. The runtime supplies authentication, database access, core
resources, and Dynamic REST endpoints.

GitHub checks compile/test the backend extensions and build the frontend wrapper
against the official pinned libraries. Releases are requested through Dreamy's API.
The trusted platform builds the exact committed source in a project-isolated
builder, deploys the sealed artifact to dev, runs authenticated core checks and
`config/e2e.json`, and promotes that artifact only after an explicit production
publish. Project workflows and project code have no deployment credentials.
