# Dreamy dynamic-rust buildpack

The default buildpack for [Dreamy](https://dreamy.so) projects: a Rust
application on [dynamic-rust](https://github.com/aleontiev/dynamic-rust) with the
[dynamic-rust-admin](https://github.com/aleontiev/dynamic-rust-admin) UI,
PostgreSQL, and serverless hosting with development and production
environments.

A buildpack is everything a Dreamy project is built on, kept out of Dreamy itself:
- the scaffold Dreamy generates around the project's own code;
- the files an agent may change;
- the tests and toolchain;
- the guide and rules coding agents follow;
- whether and how Dreamy releases the app.

Dreamy references this repository at a pinned commit and uses it for every
project that names no other buildpack.

## Use your own

Fork this repository (or start from scratch), change what you need, and give it
its own `name` in `buildpack.json`. Then add it in Dreamy under **Settings →
Buildpacks** by pasting its GitHub URL:
- `https://github.com/<owner>/<repo>` uses the default branch.
- `.../tree/<ref>` uses a branch, tag or commit.
- `.../tree/<ref>/<directory>` points at a buildpack inside a larger repository.

Dreamy pins the commit the URL resolves to and fetches the manifest and the files
beside it. Projects keep using that commit until an admin chooses **Check for
updates**.

## Contents

| File | Purpose |
| --- | --- |
| `buildpack.json` | The manifest (below). |
| `guide.md` | The framework guide coding agents read before changing a project. |
| `skill.md` | The buildpack's part of the worker skill for agents that drive the `dreamy` CLI themselves. |
| `app-data.md` | The skill for reading and changing data in a deployed app; `{command}` is replaced with the task's own command. |
| `foundation.lock.json` | The `dynamic-rust` and `dynamic-rust-admin` revisions new revisions build on. |
| `project/` | Templates for the files Dreamy generates around a project's own layers: README, Rust entry points, CI, and the admin UI's preparation script and configuration. |

## Manifest

| Key | Meaning |
| --- | --- |
| `name`, `label`, `description` | How the buildpack is named and shown. The name must be unique in a workspace. |
| `scaffold` | How Dreamy turns the project's stored files into its repository. `blueprint` and `lock` name where the blueprint and the library pins live; `map` moves stored path prefixes into the repository (`models/` → `backend/src/models/`); `vars` are `[name, expression]` pairs; `files` lists generated files in order, each `copy` (with optional `replace`), `template` (Jinja-style, rendered with `project`, `revision`, `blueprint`, `lock`, `manifest` and the vars) or `json` (an expression written as pretty JSON), optionally only `when` an expression holds; `indexes` rebuild a module index per directory from its files unless the project wrote one. Without a scaffold the stored files are the repository. |
| `blueprint_rules` | What a blueprint holds: exactly these `keys`, these `lists`, the values each `config` key may take, and names each list may not use (`reserved`). |
| `layout` | Kept for Dreamy versions before `scaffold`; ignored by current ones. |
| `lock` | The file pinning the libraries new revisions build on. |
| `guide`, `skill` | The agent guide and the buildpack's part of the worker skill. |
| `layers`, `core_models`, `blueprint` | The blueprint's shape and a new project's blueprint. |
| `max_files` | The most files a revision may hold. |
| `editable` | `include` and `exclude` rules (a path ending in `/` is a directory, `*` everything), the `summary` agents are told, and the `required` files a checkout must have. |
| `source_roots`, `ignored` | Top-level directories whose new non-editable files are reported, and build directories never uploaded. |
| `tests` | The `default` commands (run when the `when` file exists), the `database_env` naming a throwaway PostgreSQL server (`null` when the tests need none), and `e2e`: where end-to-end tests of key user flows live, completing Dreamy's own rule that every behavior gets fast code-level tests and every key flow an end-to-end test. |
| `toolchain` | Environment variables, home directories (read-only and writable) and executables the sandboxed agent needs. |
| `sources` | The lock file whose libraries are checked out read-only for the agent, and the cache directory. |
| `refresh` | The workspace action that regenerates platform-owned files, its title, and the file whose pins it reports; `null` when nothing is generated. |
| `review` | Paths and code patterns that always get a full review. |
| `reference` | The library whose public API is summarized for agents, its language, and the files that define that API. |
| `app_data` | The skill for reading and changing the deployed app's data, and the API path prefix it allows. |
| `capabilities` | `providers` (workspace providers are written into its apps), `app_data`, and `release` (Dreamy builds and deploys it). |
| `release` | The builder, deployment template and release checks. For now these name Dreamy's built-in dynamic-rust pipeline; they are moving into this repository. |
| `prompts` | The worker's `start` (`{guide_url}` marks the guide), `sources` (`{sources}` marks the checkouts) and `rules` lines, and the verifier's lines. |

## License

[MIT](LICENSE)
