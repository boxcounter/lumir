use std::sync::Arc;

use crate::config::HarnessPermissions;

use super::output::WebEnvelope;
use super::preflight::{
    run_preflight, PreflightLimits, ReqwestWebTransport, SystemDnsResolver, WebDnsResolver,
    WebTransport,
};
use super::provider::{DeepSeekWebProvider, SystemWebBackoff, WebBackoff, WebProviderRequest};

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

    #[cfg(test)]
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
            WebProviderRequest::Fetch { url } => {
                let preflight = run_preflight(
                    &url,
                    &self.permissions,
                    self.resolver.clone(),
                    self.preflight_transport.clone(),
                    aborted.clone(),
                    PreflightLimits::default(),
                );
                match preflight {
                    Ok(success) => self.provider.execute(
                        WebProviderRequest::Fetch {
                            url: success.submitted_url,
                        },
                        aborted,
                        self.backoff.clone(),
                    ),
                    Err(error) => {
                        let mut envelope = error.into_envelope();
                        envelope.source =
                            Some(super::provider::fetch_source(&url, String::new(), None));
                        envelope
                    }
                }
            }
        }
    }
}
