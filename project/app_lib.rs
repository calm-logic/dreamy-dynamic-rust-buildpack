//! Thin registration entry point. Shared behavior lives in dynamic-rust.
pub mod models;
pub mod hooks;
pub mod tasks;
pub mod roles;
pub const PROJECT_SPEC: &str = include_str!("../project.json");

pub fn registry() -> Result<dynamic_rust::application::extensions::Registry, dynamic_rust::ApiError> {
    let mut registry = dynamic_rust::application::extensions::Registry::default();
    models::register(&mut registry)?;
    roles::register(&mut registry)?;
    hooks::register(&mut registry)?;
    tasks::register(&mut registry)?;
    Ok(registry)
}
