use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::config::HarnessPermissions;

use super::budget;
use super::output::{WebEnvelope, WebErrorCode, WebFetchMode, WebOperation, WebProviderIdentity};
use super::preflight::{
    run_preflight, PreflightLimits, ReqwestWebTransport, SystemDnsResolver, WebDnsResolver,
    WebTransport,
};
use super::provider::{DeepSeekWebProvider, SystemWebBackoff, WebBackoff, WebProviderRequest};

/// 预检单跳上限；实际取它与整次 deadline 剩余时间的较小者。
const PREFLIGHT_HOP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct WebExecutor {
    provider: Arc<DeepSeekWebProvider>,
    permissions: HarnessPermissions,
    resolver: Arc<dyn WebDnsResolver>,
    preflight_transport: Arc<dyn WebTransport>,
    backoff: Arc<dyn WebBackoff>,
}

impl WebExecutor {
    pub fn new(provider: Arc<DeepSeekWebProvider>, permissions: HarnessPermissions) -> Self {
        Self {
            provider,
            permissions,
            resolver: Arc::new(SystemDnsResolver),
            preflight_transport: Arc::new(ReqwestWebTransport::new()),
            backoff: Arc::new(SystemWebBackoff),
        }
    }

    #[cfg(any(test, feature = "acceptance-web"))]
    pub fn with_dependencies_for_test(
        provider: Arc<DeepSeekWebProvider>,
        permissions: HarnessPermissions,
        resolver: Arc<dyn WebDnsResolver>,
        preflight_transport: Arc<dyn WebTransport>,
        backoff: Arc<dyn WebBackoff>,
    ) -> Self {
        Self {
            provider,
            permissions,
            resolver,
            preflight_transport,
            backoff,
        }
    }

    /// 当前活跃适配器的能力声明与身份（能力检查读这一处，生产/验收同源）。
    pub fn fetch_modes(&self) -> &[WebFetchMode] {
        self.provider.fetch_modes()
    }

    pub fn identity(&self) -> WebProviderIdentity {
        self.provider.identity()
    }

    pub fn execute(
        &self,
        request: WebProviderRequest,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> WebEnvelope {
        match request {
            WebProviderRequest::Search { .. } => {
                self.provider
                    .execute(request, aborted, self.backoff.clone())
            }
            WebProviderRequest::Fetch { url, mode, query } => {
                // 整次工具调用一个 deadline：预检与 DeepSeek 阶段共享截止时刻，不是
                // 「预检 30s + provider 150s」。预检用剩余时间；耗尽后不再发 provider 请求。
                let deadline = Instant::now() + self.provider.total_timeout(WebOperation::Fetch);
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    let mut envelope = WebEnvelope::failure(
                        WebOperation::Fetch,
                        WebErrorCode::WebTimeout,
                        "网页工具整次调用超时",
                        None,
                        0,
                    );
                    envelope.source =
                        Some(super::provider::fetch_source(&url, String::new(), None));
                    budget::failure_budget(&mut envelope);
                    return envelope;
                }
                let preflight = run_preflight(
                    &url,
                    &self.permissions,
                    self.resolver.clone(),
                    self.preflight_transport.clone(),
                    aborted.clone(),
                    PreflightLimits {
                        hop_timeout: PREFLIGHT_HOP_TIMEOUT.min(remaining),
                        chain_timeout: remaining,
                        max_redirects: PreflightLimits::default().max_redirects,
                    },
                );
                match preflight {
                    Ok(success) => {
                        let mut envelope = self.provider.execute_until(
                            WebProviderRequest::Fetch {
                                url: success.submitted_url,
                                mode,
                                query,
                            },
                            aborted,
                            self.backoff.clone(),
                            deadline,
                        );
                        envelope.local_precheck = true;
                        envelope
                    }
                    Err(error) => {
                        let mut envelope = error.into_envelope();
                        envelope.source =
                            Some(super::provider::fetch_source(&url, String::new(), None));
                        // 预检确实执行过（失败 / 超时 / 取消也是事实），审计按事实记录。
                        envelope.local_precheck = true;
                        budget::failure_budget(&mut envelope);
                        envelope
                    }
                }
            }
        }
    }
}
