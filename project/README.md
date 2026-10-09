# {{ project.name or "Untitled app" }}
<!-- Starter README: Dreamy's coding agent replaces it with a description of this app. -->
{% if project.description %}
{{ project.description }}
{% endif %}
This README will describe the app for the people who use and maintain it: what it
does and for whom, its records and workflows, who may do what, the services it
connects to, and how to run and test it.

How the repository is laid out and built is in [docs/buildpack.md](docs/buildpack.md).
