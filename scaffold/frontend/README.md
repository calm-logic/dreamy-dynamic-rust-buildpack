# Frontend

This is a wrapper over dynamic-rust-admin. Run `python3 scripts/prepare.py`, then install dependencies and build in `.work/admin`. Keep project UI overrides under `overrides/`; do not fork the shared admin implementation. Set the project's API URL in `public/app-config.js` at deployment.

The app's home page is `overrides/home/HomePage.vue`: `/` shows it inside the shared shell, and the shared dashboards stay at `/?dashboard=<id>`. Without it, `/` shows the shared dashboard page. Pages of the app's own import charts (`AppChart`), counting numbers (`AnimatedNumber`), data loading (`useLoad`, `count`, `listAll`, `overTime`, `countBy`) and links (`listRoute`) from `@/kit`, which is `kit/`: the buildpack maintains it, so use it rather than editing it.
