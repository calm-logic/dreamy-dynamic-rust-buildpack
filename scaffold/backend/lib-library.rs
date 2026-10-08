//! Project extensions linked by the shared Dreamy application runtime.
pub mod models;
pub mod hooks;
pub mod tasks;
pub mod roles;
pub const PROJECT_SPEC: &str = include_str!("../project.json");
