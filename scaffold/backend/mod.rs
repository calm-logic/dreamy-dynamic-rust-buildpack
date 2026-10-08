{% if lock.runtime_contract == 1 %}//! Project-specific {{ layer }}.
{% for module in modules %}pub mod {{ module }};
{% endfor %}
pub fn register(_registry: &mut dynamic_rust::application::extensions::Registry) -> Result<(), dynamic_rust::ApiError> {
    Ok(())
}
{% elif modules %}{% for module in modules %}pub mod {{ module }};
{% endfor %}{% else %}//! Project-specific {{ layer }}. Shared functionality belongs to the Dreamy foundation.
{% endif %}