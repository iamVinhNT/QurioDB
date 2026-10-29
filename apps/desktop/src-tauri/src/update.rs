//! Checks GitHub Releases for a newer stable QurioDB build and opens its release page.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const RELEASES_API: &str = "https://api.github.com/repos/iamVinhNT/QurioDB/releases/latest";
const RELEASE_URL_PREFIX: &str = "https://github.com/iamVinhNT/QurioDB/releases/";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub release_url: String,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateErrorCode {
    Network,
    RateLimited,
    NotFound,
    ServerError,
    InvalidResponse,
}

#[derive(Deserialize)]
struct LatestRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
}

/// Parses a plain `X.Y.Z` version. Release tags are enforced as `vX.Y.Z` by the release
/// workflow, so anything else (pre-release suffixes included) is treated as unknown.
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let parsed = (next()?, next()?, next()?);
    parts.next().is_none().then_some(parsed)
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

/// Builds the release page URL in Rust so the webview never chooses what gets opened.
fn release_page_url(version: &str) -> Option<String> {
    parse_version(version)?;
    Some(format!("{RELEASE_URL_PREFIX}tag/v{version}"))
}

async fn fetch_latest(
    client: &reqwest::Client,
    endpoint: &str,
    current: &str,
) -> Result<UpdateCheck, UpdateErrorCode> {
    let response = client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| UpdateErrorCode::Network)?;

    match response.status().as_u16() {
        200 => {}
        403 | 429 => return Err(UpdateErrorCode::RateLimited),
        404 => return Err(UpdateErrorCode::NotFound),
        500..=599 => return Err(UpdateErrorCode::ServerError),
        _ => return Err(UpdateErrorCode::Network),
    }

    let release: LatestRelease = response
        .json()
        .await
        .map_err(|_| UpdateErrorCode::InvalidResponse)?;
    let latest = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .to_string();
    let available = release.tag_name.starts_with('v') && is_newer(&latest, current);

    Ok(UpdateCheck {
        current: current.to_string(),
        latest,
        available,
        release_url: release.html_url,
        published_at: release.published_at,
    })
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateCheck, UpdateErrorCode> {
    // Compare the release core only, so a pre-release build still hears about newer releases.
    let version = &app.package_info().version;
    let current = format!("{}.{}.{}", version.major, version.minor, version.patch);
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!("QurioDB/{current}"))
        .build()
        .map_err(|_| UpdateErrorCode::Network)?;
    fetch_latest(&client, RELEASES_API, &current).await
}

#[tauri::command]
pub fn open_release_page(app: AppHandle, version: String) -> Result<(), String> {
    let url = release_page_url(&version).ok_or("Invalid release version")?;
    // tauri-plugin-opener replaces this API, but the shell plugin is already bundled and
    // allowed to open URLs, so it avoids a new dependency for one call.
    #[allow(deprecated)]
    app.shell().open(url, None).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    fn release_body(tag: &str) -> serde_json::Value {
        serde_json::json!({
            "tag_name": tag,
            "html_url": format!("https://github.com/iamVinhNT/QurioDB/releases/tag/{tag}"),
            "published_at": "2026-10-27T10:00:00Z",
            "draft": false,
            "prerelease": false
        })
    }

    async fn serve(status: u16, body: serde_json::Value) -> MockServer {
        let server = MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/latest");
                then.status(status).json_body_obj(&body);
            })
            .await;
        server
    }

    #[test]
    fn parses_plain_semver() {
        assert_eq!(parse_version("0.1.7"), Some((0, 1, 7)));
        assert_eq!(parse_version("12.0.3"), Some((12, 0, 3)));
        assert_eq!(parse_version("0.1"), None);
        assert_eq!(parse_version("0.1.7-beta.1"), None);
        assert_eq!(parse_version("v0.1.7"), None);
        assert_eq!(parse_version("nightly"), None);
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(is_newer("0.1.7", "0.1.6"));
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(!is_newer("0.1.6", "0.1.6"));
        assert!(!is_newer("0.1.5", "0.1.6"));
        assert!(!is_newer("garbage", "0.1.6"));
        assert!(!is_newer("0.1.7", "garbage"));
    }

    #[test]
    fn builds_release_page_url_only_from_a_plain_version() {
        assert_eq!(
            release_page_url("0.1.7").as_deref(),
            Some("https://github.com/iamVinhNT/QurioDB/releases/tag/v0.1.7")
        );
        for input in [
            "",
            "v0.1.7",
            "0.1.7/../../evil",
            "%2e%2e/%2e%2e/attacker/repo",
            "0.1.7?x=1",
            "https://evil.example/x",
        ] {
            assert_eq!(release_page_url(input), None, "input {input:?}");
        }
    }

    #[tokio::test]
    async fn reports_newer_release() {
        let server = serve(200, release_body("v0.1.7")).await;

        let result = fetch_latest(&reqwest::Client::new(), &server.url("/latest"), "0.1.6").await;

        assert_eq!(
            result,
            Ok(UpdateCheck {
                current: "0.1.6".into(),
                latest: "0.1.7".into(),
                available: true,
                release_url: "https://github.com/iamVinhNT/QurioDB/releases/tag/v0.1.7".into(),
                published_at: Some("2026-10-27T10:00:00Z".into()),
            })
        );
    }

    #[tokio::test]
    async fn same_or_older_release_is_not_available() {
        for tag in ["v0.1.6", "v0.1.5"] {
            let server = serve(200, release_body(tag)).await;
            let result =
                fetch_latest(&reqwest::Client::new(), &server.url("/latest"), "0.1.6").await;
            assert_eq!(result.map(|check| check.available), Ok(false), "tag {tag}");
        }
    }

    #[tokio::test]
    async fn malformed_tag_is_not_an_update() {
        for tag in ["nightly", "0.1.7", "v0.1.7-rc.1"] {
            let server = serve(200, release_body(tag)).await;
            let result =
                fetch_latest(&reqwest::Client::new(), &server.url("/latest"), "0.1.6").await;
            assert_eq!(result.map(|check| check.available), Ok(false), "tag {tag}");
        }
    }

    #[tokio::test]
    async fn maps_http_errors_to_codes() {
        let cases = [
            (404, UpdateErrorCode::NotFound),
            (403, UpdateErrorCode::RateLimited),
            (429, UpdateErrorCode::RateLimited),
            (500, UpdateErrorCode::ServerError),
            (503, UpdateErrorCode::ServerError),
        ];
        for (status, expected) in cases {
            let server = serve(status, serde_json::json!({ "message": "error" })).await;
            let result =
                fetch_latest(&reqwest::Client::new(), &server.url("/latest"), "0.1.6").await;
            assert_eq!(result, Err(expected), "status {status}");
        }
    }

    #[tokio::test]
    async fn malformed_json_is_invalid_response() {
        let server = MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/latest");
                then.status(200).body("<html>not json</html>");
            })
            .await;

        let result = fetch_latest(&reqwest::Client::new(), &server.url("/latest"), "0.1.6").await;

        assert_eq!(result, Err(UpdateErrorCode::InvalidResponse));
    }

    #[tokio::test]
    async fn timeout_is_network_error() {
        let server = MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/latest");
                then.status(200)
                    .delay(Duration::from_millis(500))
                    .json_body_obj(&release_body("v0.1.7"));
            })
            .await;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();

        let result = fetch_latest(&client, &server.url("/latest"), "0.1.6").await;

        assert_eq!(result, Err(UpdateErrorCode::Network));
    }
}
