//! Executable host supplied by Dreamy. Project code registers through lib.rs.
use dynamic_rust::application::{configured, router, task_runner};
use __PROJECT_CRATE__::registry;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if std::env::var_os("ADMIN_DATABASE_URL").is_some() {
        return Err("Project executables must never receive shared database administrator credentials".into());
    }
    let app = configured(registry()?)?;
    app.registry.migrate(&app.pool).await?;
    if std::env::var("APP_RUNTIME_MODE").as_deref() == Ok("tasks") {
        // Deploy this mode only as a separately scheduled IAM-only function. It
        // starts due tasks for 25 seconds; one may then run for up to 60 more,
        // inside the function's 90-second timeout.
        let routes = axum::Router::new().route("/", axum::routing::post(move || {
            let app = app.clone();
            async move {
                task_runner::drain(&app, std::time::Duration::from_secs(25)).await.map(|processed| axum::Json(serde_json::json!({"processed":processed})))
            }
        }));
        lambda_http::run(routes).await?;
    } else if std::env::var_os("AWS_LAMBDA_RUNTIME_API").is_some() {
        lambda_http::run(router(app)).await?;
    } else {
        let tasks = app.clone();
        tokio::spawn(async move {
            loop {
                if task_runner::drain(&tasks, std::time::Duration::from_secs(1)).await.is_err() {
                    eprintln!("Background task dispatch will retry");
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });
        let listener = tokio::net::TcpListener::bind(std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:8092".into())).await?;
        axum::serve(listener, router(app)).await?;
    }
    Ok(())
}
