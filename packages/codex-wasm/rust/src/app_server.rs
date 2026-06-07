use std::cell::RefCell;
#[cfg(feature = "real-codex")]
use std::collections::BTreeMap;
#[cfg(feature = "real-codex")]
use std::collections::HashMap;
#[cfg(feature = "real-codex")]
use std::path::PathBuf;
use std::rc::Rc;
#[cfg(feature = "real-codex")]
use std::sync::Arc;

#[cfg(feature = "real-codex")]
use async_trait::async_trait;
#[cfg(feature = "real-codex")]
use codex_app_server::protocol;
#[cfg(feature = "real-codex")]
use codex_core::CodexThread;
#[cfg(feature = "real-codex")]
use codex_core::CodexThreadSettingsOverrides;
#[cfg(feature = "real-codex")]
use codex_core::StartThreadOptions;
#[cfg(feature = "real-codex")]
use codex_core::ThreadManager;
#[cfg(feature = "real-codex")]
use codex_core::config::ConfigBuilder;
#[cfg(feature = "real-codex")]
use codex_core::config::ConfigOverrides;
#[cfg(feature = "real-codex")]
use codex_core::config::ThreadStoreConfig;
#[cfg(feature = "real-codex")]
use codex_core::thread_store_from_config;
#[cfg(feature = "real-codex")]
use codex_exec_server::EnvironmentManager;
#[cfg(feature = "real-codex")]
use codex_login::AuthManager;
#[cfg(feature = "real-codex")]
use codex_login::CodexAuth;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuth;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuthChatgptMetadata;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuthRefreshContext;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuthTokens;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::AdditionalContextEntry as CoreAdditionalContextEntry;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::AdditionalContextKind as CoreAdditionalContextKind;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::Event;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::EventMsg;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::InitialHistory;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::Op;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::SessionSource;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::ThreadSettingsOverrides;
#[cfg(feature = "real-codex")]
use codex_protocol::protocol::TurnEnvironmentSelection;
#[cfg(feature = "real-codex")]
use codex_utils_absolute_path::AbsolutePathBuf;
use js_sys::Array;
use js_sys::Object;
#[cfg(feature = "real-codex")]
use js_sys::Promise;
use js_sys::Reflect;
#[cfg(feature = "real-codex")]
use serde::de::DeserializeOwned;
#[cfg(feature = "real-codex")]
use serde::{Deserialize, Serialize};
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
#[cfg(feature = "real-codex")]
use wasm_bindgen_futures::JsFuture;
use web_sys::MessageEvent;
use web_sys::MessagePort;

#[cfg(feature = "real-codex")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = globalThis, js_name = __almostnodeCodexHostRequest, catch)]
    fn almostnode_codex_host_request(op: &str, params: JsValue) -> Result<Promise, JsValue>;

    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

#[wasm_bindgen]
pub struct CodexAppServerWasm {
    #[cfg(feature = "real-codex")]
    _server: codex_app_server::WasmAppServer,
    state: Rc<RefCell<BrowserProtocolState>>,
    port: Option<MessagePort>,
    on_message: Option<Closure<dyn FnMut(MessageEvent)>>,
}

#[derive(Default)]
struct BrowserProtocolState {
    initialize_seen: bool,
    initialized: bool,
    #[cfg(feature = "real-codex")]
    loaded_thread_ids: Vec<String>,
    #[cfg(feature = "real-codex")]
    threads: HashMap<String, BrowserThread>,
    #[cfg(feature = "real-codex")]
    thread_manager: Option<Arc<ThreadManager>>,
    #[cfg(feature = "real-codex")]
    next_host_request_id: u64,
    #[cfg(feature = "real-codex")]
    pending_host_requests: HashMap<String, PendingHostRequest>,
}

#[cfg(feature = "real-codex")]
struct BrowserThread {
    core_thread: Arc<CodexThread>,
    thread: serde_json::Value,
    history: protocol::ThreadHistoryBuilder,
    events: Vec<EventMsg>,
}

#[cfg(feature = "real-codex")]
#[derive(Clone, Debug)]
struct BrowserCodexExternalAuth {
    auth_mode: protocol::AuthMode,
    access_token: String,
    account_id: Option<String>,
    plan_type: Option<String>,
}

#[cfg(feature = "real-codex")]
fn trace_app_server_stage(stage: &str) {
    let enabled = Reflect::get(
        &js_sys::global(),
        &JsValue::from_str("__ALMOSTNODE_CODEX_WASM_TRACE"),
    )
    .ok()
    .and_then(|value| value.as_bool())
    .unwrap_or(false);
    if enabled {
        console_error(&format!("[codex-wasm app-server] {stage}"));
    }
}

#[cfg(feature = "real-codex")]
#[async_trait]
impl ExternalAuth for BrowserCodexExternalAuth {
    fn auth_mode(&self) -> protocol::AuthMode {
        self.auth_mode
    }

    async fn resolve(&self) -> std::io::Result<Option<ExternalAuthTokens>> {
        let tokens = match self.auth_mode {
            protocol::AuthMode::ApiKey => {
                ExternalAuthTokens::access_token_only(self.access_token.clone())
            }
            protocol::AuthMode::Chatgpt | protocol::AuthMode::ChatgptAuthTokens => {
                ExternalAuthTokens {
                    access_token: self.access_token.clone(),
                    chatgpt_metadata: self.account_id.clone().map(|account_id| {
                        ExternalAuthChatgptMetadata {
                            account_id,
                            plan_type: self.plan_type.clone(),
                        }
                    }),
                }
            }
            protocol::AuthMode::AgentIdentity => {
                return Ok(None);
            }
        };
        Ok(Some(tokens))
    }

    async fn refresh(
        &self,
        _context: ExternalAuthRefreshContext,
    ) -> std::io::Result<ExternalAuthTokens> {
        self.resolve()
            .await?
            .ok_or_else(|| std::io::Error::other("Codex browser auth is unavailable"))
    }
}

#[cfg(feature = "real-codex")]
#[derive(Debug)]
enum PendingHostRequest {
    FsReadFile {
        request_id: protocol::RequestId,
    },
    FsWriteFile {
        request_id: protocol::RequestId,
    },
    FsCreateDirectory {
        request_id: protocol::RequestId,
    },
    FsReadDirectory {
        request_id: protocol::RequestId,
    },
    FsGetMetadata {
        request_id: protocol::RequestId,
    },
    CommandExec {
        request_id: protocol::RequestId,
        streamed: bool,
    },
    CommandExecWrite {
        request_id: protocol::RequestId,
    },
    CommandExecTerminate {
        request_id: protocol::RequestId,
    },
    CommandExecResize {
        request_id: protocol::RequestId,
    },
    ProcessSpawn {
        request_id: protocol::RequestId,
    },
    ProcessWriteStdin {
        request_id: protocol::RequestId,
    },
    ProcessKill {
        request_id: protocol::RequestId,
    },
    ProcessResizePty {
        request_id: protocol::RequestId,
    },
}

#[wasm_bindgen]
impl CodexAppServerWasm {
    #[wasm_bindgen(constructor)]
    pub fn new() -> CodexAppServerWasm {
        console_error_panic_hook::set_once();
        CodexAppServerWasm {
            #[cfg(feature = "real-codex")]
            _server: codex_app_server::WasmAppServer::new(),
            state: Rc::new(RefCell::new(BrowserProtocolState::default())),
            port: None,
            on_message: None,
        }
    }

    #[wasm_bindgen]
    pub fn start(&mut self, port: JsValue, _initialize: JsValue) -> Result<(), JsValue> {
        let port = port
            .dyn_into::<MessagePort>()
            .map_err(|_| JsValue::from_str("Codex app-server start() expected a MessagePort."))?;
        let listener_port = port.clone();
        let state = Rc::clone(&self.state);
        *state.borrow_mut() = BrowserProtocolState::default();
        let on_message = Closure::wrap(Box::new(move |event: MessageEvent| {
            let data = event.data();
            if let Err(error) = handle_message(&listener_port, data, &state) {
                let _ = post_error_notification(&listener_port, error);
            }
        }) as Box<dyn FnMut(MessageEvent)>);

        port.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
        port.start();
        self.port = Some(port);
        self.on_message = Some(on_message);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn dispose(&mut self) {
        if let Some(port) = self.port.take() {
            port.set_onmessage(None);
            port.close();
        }
        self.on_message = None;
    }
}

#[wasm_bindgen(js_name = createCodexAppServerWasm)]
pub fn create_codex_app_server_wasm() -> CodexAppServerWasm {
    CodexAppServerWasm::new()
}

fn handle_message(
    port: &MessagePort,
    data: JsValue,
    state: &Rc<RefCell<BrowserProtocolState>>,
) -> Result<(), JsValue> {
    #[cfg(feature = "real-codex")]
    if is_host_response(&data) {
        return handle_host_response(port, data, state);
    }

    #[cfg(feature = "real-codex")]
    if is_host_event(&data) {
        return handle_host_event(port, data);
    }

    if is_notification(&data) {
        return handle_notification(data, state);
    }

    if !is_request(&data) {
        return Ok(());
    }

    let id = Reflect::get(&data, &JsValue::from_str("id"))?;
    let method = Reflect::get(&data, &JsValue::from_str("method"))?
        .as_string()
        .unwrap_or_default();

    match method.as_str() {
        "appServer/status" => post_response(port, id, status_result(state)),
        "shutdown" => post_response(port, id, Object::new().into()),
        "" => post_error_response(port, id, -32600, "invalid JSON-RPC request"),
        _ => handle_protocol_request(port, data, state),
    }
}

fn handle_notification(
    data: JsValue,
    state: &Rc<RefCell<BrowserProtocolState>>,
) -> Result<(), JsValue> {
    let method = Reflect::get(&data, &JsValue::from_str("method"))?
        .as_string()
        .unwrap_or_default();
    if method == "initialized" {
        state.borrow_mut().initialized = true;
    }
    Ok(())
}

fn is_request(data: &JsValue) -> bool {
    if !data.is_object() || data.is_null() || data.is_undefined() {
        return false;
    }
    let id = Reflect::get(data, &JsValue::from_str("id")).unwrap_or(JsValue::UNDEFINED);
    let method = Reflect::get(data, &JsValue::from_str("method")).unwrap_or(JsValue::UNDEFINED);
    !id.is_null() && !id.is_undefined() && method.as_string().is_some()
}

fn is_notification(data: &JsValue) -> bool {
    if !data.is_object() || data.is_null() || data.is_undefined() {
        return false;
    }
    let id = Reflect::get(data, &JsValue::from_str("id")).unwrap_or(JsValue::UNDEFINED);
    let method = Reflect::get(data, &JsValue::from_str("method")).unwrap_or(JsValue::UNDEFINED);
    (id.is_null() || id.is_undefined()) && method.as_string().is_some()
}

#[cfg(feature = "real-codex")]
fn is_host_response(data: &JsValue) -> bool {
    if !data.is_object() || data.is_null() || data.is_undefined() {
        return false;
    }
    Reflect::get(data, &JsValue::from_str("type"))
        .ok()
        .and_then(|value| value.as_string())
        .as_deref()
        == Some("codex/host/response")
}

#[cfg(feature = "real-codex")]
fn is_host_event(data: &JsValue) -> bool {
    if !data.is_object() || data.is_null() || data.is_undefined() {
        return false;
    }
    Reflect::get(data, &JsValue::from_str("type"))
        .ok()
        .and_then(|value| value.as_string())
        .as_deref()
        == Some("codex/host/event")
}

#[cfg(feature = "real-codex")]
fn handle_protocol_request(
    port: &MessagePort,
    data: JsValue,
    state: &Rc<RefCell<BrowserProtocolState>>,
) -> Result<(), JsValue> {
    let _absolute_path_guard =
        codex_utils_absolute_path::AbsolutePathBufGuard::new(std::path::Path::new("/"));
    let request = match serde_wasm_bindgen::from_value::<protocol::ClientRequest>(data.clone()) {
        Ok(request) => request,
        Err(err) => {
            let id = Reflect::get(&data, &JsValue::from_str("id"))?;
            return post_error_response(
                port,
                id,
                -32602,
                &format!("invalid Codex app-server request params: {err}"),
            );
        }
    };
    let method = request.method();
    let response = match request {
        protocol::ClientRequest::Initialize { request_id, .. } => {
            state.borrow_mut().initialize_seen = true;
            jsonrpc_response_value(request_id, initialize_result())?
        }
        protocol::ClientRequest::ThreadStart { request_id, params } => {
            return start_browser_thread(port, state, request_id, params);
        }
        protocol::ClientRequest::ThreadList { request_id, params } => {
            jsonrpc_response_value(request_id, thread_list_result(state, params)?)?
        }
        protocol::ClientRequest::ThreadSearch { request_id, params } => {
            jsonrpc_response_value(request_id, thread_search_result(state, params)?)?
        }
        protocol::ClientRequest::ThreadLoadedList { request_id, params } => {
            jsonrpc_response_value(request_id, thread_loaded_list_result(state, params))?
        }
        protocol::ClientRequest::ThreadRead { request_id, params } => {
            return read_browser_thread(port, state, request_id, params);
        }
        protocol::ClientRequest::ThreadTurnsList { request_id, params } => {
            return list_browser_thread_turns(port, state, request_id, params);
        }
        protocol::ClientRequest::ThreadTurnsItemsList { request_id, params } => {
            return list_browser_thread_turn_items(port, state, request_id, params);
        }
        protocol::ClientRequest::ThreadInjectItems { request_id, params } => {
            return inject_browser_thread_items(port, state, request_id, params);
        }
        protocol::ClientRequest::ThreadUnsubscribe { request_id, params } => {
            let status = if state.borrow().threads.contains_key(&params.thread_id) {
                "unsubscribed"
            } else {
                "notLoaded"
            };
            jsonrpc_response_value(request_id, serde_json::json!({ "status": status }))?
        }
        protocol::ClientRequest::FsReadFile { request_id, params } => {
            return request_host_fs_read_file(port, state, request_id, params);
        }
        protocol::ClientRequest::FsWriteFile { request_id, params } => {
            return request_host_fs_write_file(port, state, request_id, params);
        }
        protocol::ClientRequest::FsCreateDirectory { request_id, params } => {
            return request_host_fs_create_directory(port, state, request_id, params);
        }
        protocol::ClientRequest::FsReadDirectory { request_id, params } => {
            return request_host_fs_read_directory(port, state, request_id, params);
        }
        protocol::ClientRequest::FsGetMetadata { request_id, params } => {
            return request_host_fs_get_metadata(port, state, request_id, params);
        }
        protocol::ClientRequest::OneOffCommandExec { request_id, params } => {
            return request_host_command_exec(port, state, request_id, params);
        }
        protocol::ClientRequest::CommandExecWrite { request_id, params } => {
            return request_host_command_write(port, state, request_id, params);
        }
        protocol::ClientRequest::CommandExecTerminate { request_id, params } => {
            return request_host_command_terminate(port, state, request_id, params);
        }
        protocol::ClientRequest::CommandExecResize { request_id, params } => {
            return request_host_command_resize(port, state, request_id, params);
        }
        protocol::ClientRequest::ProcessSpawn { request_id, params } => {
            return request_host_process_spawn(port, state, request_id, params);
        }
        protocol::ClientRequest::ProcessWriteStdin { request_id, params } => {
            return request_host_process_write_stdin(port, state, request_id, params);
        }
        protocol::ClientRequest::ProcessKill { request_id, params } => {
            return request_host_process_kill(port, state, request_id, params);
        }
        protocol::ClientRequest::ProcessResizePty { request_id, params } => {
            return request_host_process_resize_pty(port, state, request_id, params);
        }
        protocol::ClientRequest::TurnStart { request_id, params } => {
            return start_browser_turn(port, state, request_id, params);
        }
        other => {
            return post_error_response(
                port,
                request_id_to_js_value(other.id()),
                -32601,
                &format!(
                    "Codex browser app-server decoded `{method}`, but this method needs the \
                     native in-process MessageProcessor or almostnode host-bridge runtime."
                ),
            );
        }
    };
    port.post_message(&response)
}

#[cfg(feature = "real-codex")]
fn start_browser_thread(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadStartParams,
) -> Result<(), JsValue> {
    let port = port.clone();
    let state = Rc::clone(state);
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(error) = start_core_thread_async(&port, &state, request_id.clone(), params).await
        {
            let _ = post_error_response(
                &port,
                request_id_to_js_value(&request_id),
                -32000,
                &js_error_to_string(error),
            );
        }
    });
    Ok(())
}

#[cfg(feature = "real-codex")]
async fn start_core_thread_async(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadStartParams,
) -> Result<(), JsValue> {
    trace_app_server_stage("thread/start: begin");
    let cwd = normalize_browser_path(params.cwd.as_deref().unwrap_or("/project"));
    trace_app_server_stage("thread/start: building Config");
    let mut config = ConfigBuilder::default()
        .codex_home(PathBuf::from("/home/user/.codex"))
        .harness_overrides(ConfigOverrides {
            model: params.model.clone(),
            cwd: Some(PathBuf::from(&cwd)),
            approval_policy: params
                .approval_policy
                .map(protocol::AskForApproval::to_core),
            approvals_reviewer: params
                .approvals_reviewer
                .map(protocol::ApprovalsReviewer::to_core),
            sandbox_mode: params.sandbox.map(protocol::SandboxMode::to_core),
            model_provider: params.model_provider.clone(),
            service_tier: params.service_tier.clone(),
            base_instructions: params.base_instructions.clone(),
            developer_instructions: params.developer_instructions.clone(),
            personality: params.personality.clone(),
            ephemeral: Some(params.ephemeral.unwrap_or(true)),
            workspace_roots: params.runtime_workspace_roots.clone(),
            ..ConfigOverrides::default()
        })
        .build()
        .await
        .map_err(|error| to_js_error(format!("Codex config build failed: {error}")))?;
    config.experimental_thread_store = ThreadStoreConfig::InMemory {
        id: "browser-codex".to_string(),
    };

    trace_app_server_stage("thread/start: building AuthManager");
    let auth_manager = browser_auth_manager(&config).await.map_err(|error| {
        to_js_error(format!(
            "Codex auth manager setup failed: {}",
            js_error_to_string(error)
        ))
    })?;
    trace_app_server_stage("thread/start: building EnvironmentManager");
    let environment_manager = Arc::new(EnvironmentManager::default_for_tests());
    trace_app_server_stage("thread/start: building ThreadStore");
    let thread_store = thread_store_from_config(&config, /*state_db*/ None);
    trace_app_server_stage("thread/start: building ThreadManager");
    let thread_manager = Arc::new(ThreadManager::new(
        &config,
        Arc::clone(&auth_manager),
        SessionSource::Custom("appServer".to_string()),
        environment_manager,
        codex_extension_api::empty_extension_registry(),
        /*analytics_events_client*/ None,
        thread_store,
        /*state_db*/ None,
        uuid::Uuid::new_v4().to_string(),
        /*attestation_provider*/ None,
    ));
    trace_app_server_stage("thread/start: resolving environments");
    let environments = params
        .environments
        .clone()
        .map(turn_environment_params_to_core)
        .unwrap_or_else(|| thread_manager.default_environment_selections(&config.cwd));
    let dynamic_tools = params
        .dynamic_tools
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|tool| codex_protocol::dynamic_tools::DynamicToolSpec {
            namespace: tool.namespace,
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
            defer_loading: tool.defer_loading,
        })
        .collect();
    trace_app_server_stage("thread/start: starting upstream CodexThread");
    let new_thread = thread_manager
        .start_thread_with_options(StartThreadOptions {
            config,
            initial_history: InitialHistory::New,
            session_source: Some(SessionSource::Custom("appServer".to_string())),
            thread_source: params.thread_source.map(Into::into),
            dynamic_tools,
            metrics_service_name: params.service_name.clone(),
            parent_trace: None,
            environments,
        })
        .await
        .map_err(|error| to_js_error(format!("Codex thread start failed: {error}")))?;
    trace_app_server_stage("thread/start: upstream CodexThread started");

    let thread_id = new_thread.thread_id.to_string();
    let config_snapshot = new_thread.thread.config_snapshot().await;
    let instruction_sources = new_thread
        .thread
        .instruction_sources()
        .await
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let created_at = browser_epoch_seconds();
    let sandbox = sandbox_policy_json(params.sandbox);
    let thread_source = new_thread
        .session_configured
        .thread_source
        .as_ref()
        .and_then(|source| serde_json::to_value(source).ok())
        .unwrap_or(serde_json::Value::Null);
    let rollout_path = new_thread
        .session_configured
        .rollout_path
        .as_ref()
        .map(|path| serde_json::json!(path.to_string_lossy().into_owned()))
        .unwrap_or(serde_json::Value::Null);
    let thread = serde_json::json!({
        "id": thread_id,
        "sessionId": new_thread.session_configured.session_id.to_string(),
        "forkedFromId": new_thread.session_configured.forked_from_id.map(|id| id.to_string()),
        "parentThreadId": new_thread.session_configured.parent_thread_id.map(|id| id.to_string()),
        "preview": "",
        "ephemeral": config_snapshot.ephemeral,
        "modelProvider": config_snapshot.model_provider_id.clone(),
        "createdAt": created_at,
        "updatedAt": created_at,
        "status": { "type": "idle" },
        "path": rollout_path,
        "cwd": config_snapshot.cwd.to_string_lossy().into_owned(),
        "cliVersion": env!("CARGO_PKG_VERSION"),
        "source": "appServer",
        "threadSource": thread_source,
        "agentNickname": null,
        "agentRole": null,
        "gitInfo": null,
        "name": new_thread.session_configured.thread_name,
        "turns": [],
    });
    let start_response = serde_json::json!({
        "thread": thread.clone(),
        "model": config_snapshot.model,
        "modelProvider": config_snapshot.model_provider_id,
        "serviceTier": config_snapshot.service_tier,
        "cwd": config_snapshot.cwd.to_string_lossy().into_owned(),
        "runtimeWorkspaceRoots": config_snapshot.workspace_roots.iter().map(|path| path.to_string_lossy().into_owned()).collect::<Vec<_>>(),
        "instructionSources": instruction_sources,
        "approvalPolicy": protocol::AskForApproval::from(config_snapshot.approval_policy),
        "approvalsReviewer": protocol::ApprovalsReviewer::from(config_snapshot.approvals_reviewer),
        "sandbox": sandbox,
        "activePermissionProfile": config_snapshot.active_permission_profile,
        "reasoningEffort": config_snapshot.reasoning_effort,
    });

    {
        let mut state = state.borrow_mut();
        state.thread_manager = Some(Arc::clone(&thread_manager));
        state.loaded_thread_ids.push(thread_id.clone());
        state.threads.insert(thread_id.clone(), BrowserThread {
            core_thread: Arc::clone(&new_thread.thread),
            thread: start_response["thread"].clone(),
            history: protocol::ThreadHistoryBuilder::new(),
            events: Vec::new(),
        });
    }

    post_protocol_json_response(port, request_id, start_response)?;
    post_thread_started_notification(port, thread)?;
    spawn_core_thread_event_pump(port.clone(), Rc::clone(state), thread_id, new_thread.thread);
    Ok(())
}

#[cfg(feature = "real-codex")]
async fn browser_auth_manager(
    config: &codex_core::config::Config,
) -> Result<Arc<AuthManager>, JsValue> {
    let env = host_request_json::<HostAuthEnvResult, _>("auth/env", &serde_json::json!({}))
        .await?
        .env;
    if let Some(api_key) = env
        .get("CODEX_API_KEY")
        .or_else(|| env.get("OPENAI_API_KEY"))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(AuthManager::from_auth_for_testing_with_home(
            CodexAuth::from_api_key(api_key),
            config.codex_home.to_path_buf(),
        ));
    }

    let Some(access_token) = env
        .get("CODEX_ACCESS_TOKEN")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Err(JsValue::from_str(
            "Codex auth is not available. Connect Codex in Keychain or set OPENAI_API_KEY, CODEX_API_KEY, or CODEX_ACCESS_TOKEN.",
        ));
    };

    let auth_manager =
        AuthManager::shared_from_config(config, /*enable_codex_api_key_env*/ false).await;
    auth_manager.set_external_auth(Arc::new(BrowserCodexExternalAuth {
        auth_mode: protocol::AuthMode::ChatgptAuthTokens,
        access_token,
        account_id: env
            .get("CODEX_CHATGPT_ACCOUNT_ID")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        plan_type: env
            .get("CODEX_CHATGPT_PLAN_TYPE")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    }));
    Ok(auth_manager)
}

#[cfg(feature = "real-codex")]
#[derive(Debug, Deserialize)]
struct HostAuthEnvResult {
    #[serde(default)]
    env: HashMap<String, String>,
}

#[cfg(feature = "real-codex")]
async fn host_request_json<T, P>(op: &str, params: &P) -> Result<T, JsValue>
where
    T: DeserializeOwned,
    P: Serialize + ?Sized,
{
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    let params = params.serialize(&serializer).map_err(to_js_error)?;
    let promise = almostnode_codex_host_request(op, params)?;
    let result = JsFuture::from(promise).await?;
    serde_wasm_bindgen::from_value(result).map_err(to_js_error)
}

#[cfg(feature = "real-codex")]
fn turn_environment_params_to_core(
    environments: Vec<protocol::TurnEnvironmentParams>,
) -> Vec<TurnEnvironmentSelection> {
    environments
        .into_iter()
        .map(|environment| TurnEnvironmentSelection {
            environment_id: environment.environment_id,
            cwd: environment.cwd,
        })
        .collect()
}

#[cfg(feature = "real-codex")]
fn map_additional_context(
    additional_context: Option<HashMap<String, protocol::AdditionalContextEntry>>,
) -> BTreeMap<String, CoreAdditionalContextEntry> {
    additional_context
        .unwrap_or_default()
        .into_iter()
        .map(|(key, entry)| {
            (key, CoreAdditionalContextEntry {
                value: entry.value,
                kind: match entry.kind {
                    protocol::AdditionalContextKind::Untrusted => {
                        CoreAdditionalContextKind::Untrusted
                    }
                    protocol::AdditionalContextKind::Application => {
                        CoreAdditionalContextKind::Application
                    }
                },
            })
        })
        .collect()
}

#[cfg(feature = "real-codex")]
fn resolve_runtime_workspace_roots(
    workspace_roots: Vec<PathBuf>,
    base_cwd: &AbsolutePathBuf,
) -> Vec<AbsolutePathBuf> {
    let mut resolved_roots = Vec::new();
    for path in workspace_roots {
        let root = AbsolutePathBuf::resolve_path_against_base(path, base_cwd.as_path());
        if !resolved_roots.iter().any(|existing| existing == &root) {
            resolved_roots.push(root);
        }
    }
    resolved_roots
}

#[cfg(feature = "real-codex")]
fn spawn_core_thread_event_pump(
    port: MessagePort,
    state: Rc<RefCell<BrowserProtocolState>>,
    thread_id: String,
    thread: Arc<CodexThread>,
) {
    wasm_bindgen_futures::spawn_local(async move {
        loop {
            match thread.next_event().await {
                Ok(event) => {
                    let should_stop = matches!(event.msg, EventMsg::ShutdownComplete);
                    if let Err(error) = handle_core_thread_event(&port, &state, &thread_id, event) {
                        let _ = post_error_notification(&port, error);
                    }
                    if should_stop {
                        break;
                    }
                }
                Err(error) => {
                    let _ = post_json_notification(
                        &port,
                        "error",
                        serde_json::json!({
                            "error": {
                                "message": error.to_string(),
                                "codexErrorInfo": null,
                                "additionalDetails": null,
                            },
                            "willRetry": false,
                            "threadId": thread_id,
                            "turnId": null,
                        }),
                    );
                    break;
                }
            }
        }
    });
}

#[cfg(feature = "real-codex")]
fn handle_core_thread_event(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    thread_id: &str,
    event: Event,
) -> Result<(), JsValue> {
    let turn_id = event.id.clone();
    let msg = event.msg;
    let (active_turn, completed_turn, aborted_turn) = {
        let mut state = state.borrow_mut();
        let Some(thread) = state.threads.get_mut(thread_id) else {
            return Ok(());
        };
        thread.history.handle_event(&msg);
        thread.events.push(msg.clone());
        let active_turn = thread.history.active_turn_snapshot();
        if let Some(turn) = active_turn.as_ref() {
            thread.thread["updatedAt"] = serde_json::json!(browser_epoch_seconds());
            thread.thread["status"] =
                if matches!(msg, EventMsg::TurnComplete(_) | EventMsg::TurnAborted(_)) {
                    serde_json::json!({ "type": "idle" })
                } else if thread.history.has_active_turn() {
                    serde_json::json!({ "type": "active", "activeFlags": [] })
                } else {
                    serde_json::json!({ "type": "idle" })
                };
            if let Some(preview) = latest_turn_preview(turn) {
                thread.thread["preview"] = serde_json::json!(preview);
            }
        }
        let completed_turn = matches!(msg, EventMsg::TurnComplete(_))
            .then(|| active_turn.clone())
            .flatten();
        let aborted_turn = matches!(msg, EventMsg::TurnAborted(_))
            .then(|| active_turn.clone())
            .flatten();
        (active_turn, completed_turn, aborted_turn)
    };

    match msg {
        EventMsg::TurnStarted(_) => {
            if let Some(turn) = active_turn {
                post_protocol_notification(
                    port,
                    protocol::ServerNotification::TurnStarted(protocol::TurnStartedNotification {
                        thread_id: thread_id.to_string(),
                        turn,
                    }),
                )?;
            }
            post_json_notification(
                port,
                "thread/status/changed",
                serde_json::json!({
                    "threadId": thread_id,
                    "status": { "type": "active", "activeFlags": [] },
                }),
            )?;
        }
        EventMsg::TurnComplete(_) => {
            if let Some(turn) = completed_turn {
                post_protocol_notification(
                    port,
                    protocol::ServerNotification::TurnCompleted(
                        protocol::TurnCompletedNotification {
                            thread_id: thread_id.to_string(),
                            turn,
                        },
                    ),
                )?;
            }
            post_json_notification(
                port,
                "thread/status/changed",
                serde_json::json!({
                    "threadId": thread_id,
                    "status": { "type": "idle" },
                }),
            )?;
        }
        EventMsg::TurnAborted(_) => {
            if let Some(turn) = aborted_turn {
                post_protocol_notification(
                    port,
                    protocol::ServerNotification::TurnCompleted(
                        protocol::TurnCompletedNotification {
                            thread_id: thread_id.to_string(),
                            turn,
                        },
                    ),
                )?;
            }
            post_json_notification(
                port,
                "thread/status/changed",
                serde_json::json!({
                    "threadId": thread_id,
                    "status": { "type": "idle" },
                }),
            )?;
        }
        EventMsg::Error(error) => {
            let codex_error_info = error.codex_error_info.map(protocol::CodexErrorInfo::from);
            post_json_notification(
                port,
                "error",
                serde_json::json!({
                    "error": {
                        "message": error.message,
                        "codexErrorInfo": codex_error_info,
                        "additionalDetails": null,
                    },
                    "willRetry": false,
                    "threadId": thread_id,
                    "turnId": turn_id,
                }),
            )?;
        }
        EventMsg::StreamError(error) => {
            let codex_error_info = error.codex_error_info.map(protocol::CodexErrorInfo::from);
            post_json_notification(
                port,
                "error",
                serde_json::json!({
                    "error": {
                        "message": error.message,
                        "codexErrorInfo": codex_error_info,
                        "additionalDetails": error.additional_details,
                    },
                    "willRetry": true,
                    "threadId": thread_id,
                    "turnId": turn_id,
                }),
            )?;
        }
        msg if is_item_notification_event(&msg) => {
            let notification =
                protocol::item_event_to_server_notification(msg, thread_id, &turn_id);
            post_protocol_notification(port, notification)?;
        }
        _ => {}
    }
    Ok(())
}

#[cfg(feature = "real-codex")]
fn is_item_notification_event(msg: &EventMsg) -> bool {
    matches!(
        msg,
        EventMsg::DynamicToolCallResponse(_)
            | EventMsg::CollabAgentSpawnBegin(_)
            | EventMsg::CollabAgentSpawnEnd(_)
            | EventMsg::CollabAgentInteractionBegin(_)
            | EventMsg::CollabAgentInteractionEnd(_)
            | EventMsg::CollabWaitingBegin(_)
            | EventMsg::CollabWaitingEnd(_)
            | EventMsg::CollabCloseBegin(_)
            | EventMsg::CollabCloseEnd(_)
            | EventMsg::CollabResumeBegin(_)
            | EventMsg::CollabResumeEnd(_)
            | EventMsg::AgentMessageContentDelta(_)
            | EventMsg::PlanDelta(_)
            | EventMsg::ReasoningContentDelta(_)
            | EventMsg::ReasoningRawContentDelta(_)
            | EventMsg::AgentReasoningSectionBreak(_)
            | EventMsg::ItemStarted(_)
            | EventMsg::ItemCompleted(_)
            | EventMsg::PatchApplyUpdated(_)
            | EventMsg::TerminalInteraction(_)
            | EventMsg::ExecCommandBegin(_)
            | EventMsg::ExecCommandOutputDelta(_)
            | EventMsg::ExecCommandEnd(_)
    )
}

#[cfg(feature = "real-codex")]
fn turns_from_events(events: &[EventMsg]) -> Vec<protocol::Turn> {
    let mut builder = protocol::ThreadHistoryBuilder::new();
    for event in events {
        builder.handle_event(event);
    }
    builder.finish()
}

#[cfg(feature = "real-codex")]
fn latest_turn_preview(turn: &protocol::Turn) -> Option<String> {
    turn.items.iter().rev().find_map(|item| match item {
        protocol::ThreadItem::AgentMessage { text, .. } => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.chars().take(160).collect())
        }
        protocol::ThreadItem::UserMessage { content, .. } => content.iter().find_map(|input| {
            if let protocol::UserInput::Text { text, .. } = input {
                let trimmed = text.trim();
                (!trimmed.is_empty()).then(|| trimmed.chars().take(160).collect())
            } else {
                None
            }
        }),
        _ => None,
    })
}

#[cfg(feature = "real-codex")]
fn read_browser_thread(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadReadParams,
) -> Result<(), JsValue> {
    let thread = state
        .borrow()
        .threads
        .get(&params.thread_id)
        .map(|thread| browser_thread_json(thread, params.include_turns));
    match thread {
        Some(thread) => post_protocol_json_response(
            port,
            request_id,
            serde_json::json!({
                "thread": thread,
            }),
        ),
        None => post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32004,
            &format!("browser thread not found: {}", params.thread_id),
        ),
    }
}

#[cfg(feature = "real-codex")]
fn list_browser_thread_turns(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadTurnsListParams,
) -> Result<(), JsValue> {
    let mut turns = {
        let state = state.borrow();
        let Some(thread) = state.threads.get(&params.thread_id) else {
            return post_error_response(
                port,
                request_id_to_js_value(&request_id),
                -32004,
                &format!("browser thread not found: {}", params.thread_id),
            );
        };
        turns_from_events(&thread.events)
    };
    turns.reverse();
    let turn_values = turns
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_js_error)?;
    let (turns, next_cursor) = paginate_values(&turn_values, params.cursor, params.limit);
    post_protocol_json_response(
        port,
        request_id,
        serde_json::json!({
            "data": turns,
            "nextCursor": next_cursor,
            "backwardsCursor": null,
        }),
    )
}

#[cfg(feature = "real-codex")]
fn list_browser_thread_turn_items(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadTurnsItemsListParams,
) -> Result<(), JsValue> {
    let items = {
        let state = state.borrow();
        let Some(thread) = state.threads.get(&params.thread_id) else {
            return post_error_response(
                port,
                request_id_to_js_value(&request_id),
                -32004,
                &format!("browser thread not found: {}", params.thread_id),
            );
        };
        let turns = turns_from_events(&thread.events);
        let Some(turn) = turns.iter().find(|turn| turn.id == params.turn_id) else {
            return post_error_response(
                port,
                request_id_to_js_value(&request_id),
                -32004,
                &format!("browser turn not found: {}", params.turn_id),
            );
        };
        turn.items
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_js_error)?
    };
    let (items, next_cursor) = paginate_values(&items, params.cursor, params.limit);
    post_protocol_json_response(
        port,
        request_id,
        serde_json::json!({
            "data": items,
            "nextCursor": next_cursor,
            "backwardsCursor": null,
        }),
    )
}

#[cfg(feature = "real-codex")]
fn inject_browser_thread_items(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadInjectItemsParams,
) -> Result<(), JsValue> {
    let Some(thread) = state
        .borrow()
        .threads
        .get(&params.thread_id)
        .map(|thread| Arc::clone(&thread.core_thread))
    else {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32004,
            &format!("browser thread not found: {}", params.thread_id),
        );
    };

    let port = port.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let items = params
            .items
            .into_iter()
            .enumerate()
            .map(|(index, value)| {
                serde_json::from_value::<codex_protocol::models::ResponseItem>(value)
                    .map_err(|err| format!("items[{index}] is not a valid response item: {err}"))
            })
            .collect::<Result<Vec<_>, _>>();
        let result = match items {
            Ok(items) => thread
                .inject_response_items(items)
                .await
                .map(|_| serde_json::json!({}))
                .map_err(|err| err.to_string()),
            Err(error) => Err(error),
        };

        match result {
            Ok(value) => {
                let _ = post_protocol_json_response(&port, request_id, value);
            }
            Err(error) => {
                let _ =
                    post_error_response(&port, request_id_to_js_value(&request_id), -32602, &error);
            }
        }
    });
    Ok(())
}

#[cfg(feature = "real-codex")]
fn start_browser_turn(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::TurnStartParams,
) -> Result<(), JsValue> {
    let Some(thread) = state
        .borrow()
        .threads
        .get(&params.thread_id)
        .map(|thread| Arc::clone(&thread.core_thread))
    else {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32004,
            &format!("browser thread not found: {}", params.thread_id),
        );
    };

    let port = port.clone();
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(error) = start_core_turn_async(&port, thread, request_id.clone(), params).await {
            let _ = post_error_response(
                &port,
                request_id_to_js_value(&request_id),
                -32000,
                &js_error_to_string(error),
            );
        }
    });
    Ok(())
}

#[cfg(feature = "real-codex")]
async fn start_core_turn_async(
    port: &MessagePort,
    thread: Arc<CodexThread>,
    request_id: protocol::RequestId,
    params: protocol::TurnStartParams,
) -> Result<(), JsValue> {
    let thread_settings = build_turn_thread_settings_overrides(&thread, &params).await?;
    let thread_id = params.thread_id;
    let client_user_message_id = params.client_user_message_id;
    let input = params
        .input
        .into_iter()
        .map(protocol::UserInput::into_core)
        .collect::<Vec<_>>();
    let turn_has_input = !input.is_empty();
    let environments = params.environments.map(turn_environment_params_to_core);
    let additional_context = map_additional_context(params.additional_context);

    let turn_id = thread
        .submit_user_input_with_client_user_message_id(
            Op::UserInput {
                items: input,
                environments,
                final_output_json_schema: params.output_schema,
                responsesapi_client_metadata: params.responsesapi_client_metadata,
                additional_context,
                thread_settings,
            },
            None,
            client_user_message_id,
        )
        .await
        .map_err(to_js_error)?;

    let turn = protocol::Turn {
        id: turn_id,
        items: Vec::new(),
        items_view: protocol::TurnItemsView::NotLoaded,
        error: None,
        status: protocol::TurnStatus::InProgress,
        started_at: None,
        completed_at: None,
        duration_ms: None,
    };
    let result = serde_json::to_value(protocol::TurnStartResponse { turn }).map_err(to_js_error)?;
    post_protocol_json_response(port, request_id, result)?;

    if turn_has_input {
        let _ = post_json_notification(
            port,
            "thread/status/changed",
            serde_json::json!({
                "threadId": thread_id,
                "status": { "type": "active", "activeFlags": [] },
            }),
        );
    }

    Ok(())
}

#[cfg(feature = "real-codex")]
async fn build_turn_thread_settings_overrides(
    thread: &CodexThread,
    params: &protocol::TurnStartParams,
) -> Result<ThreadSettingsOverrides, JsValue> {
    if params.sandbox_policy.is_some() && params.permissions.is_some() {
        return Err(JsValue::from_str(
            "`permissions` cannot be combined with `sandboxPolicy`",
        ));
    }
    if params.permissions.is_some() {
        return Err(JsValue::from_str(
            "turn/start permissions profile selection requires the upstream config manager host shim",
        ));
    }

    let snapshot = if params.runtime_workspace_roots.is_some() {
        Some(thread.config_snapshot().await)
    } else {
        None
    };
    let runtime_workspace_roots =
        if let Some(workspace_roots) = params.runtime_workspace_roots.clone() {
            let Some(snapshot) = snapshot.as_ref() else {
                return Err(JsValue::from_str(
                    "turn/start runtime workspace roots missing thread snapshot",
                ));
            };
            let base_cwd = params
                .cwd
                .as_ref()
                .map(|cwd| AbsolutePathBuf::resolve_path_against_base(cwd, snapshot.cwd.as_path()))
                .unwrap_or_else(|| snapshot.cwd.clone());
            Some(resolve_runtime_workspace_roots(workspace_roots, &base_cwd))
        } else {
            None
        };
    let approval_policy = params
        .approval_policy
        .map(protocol::AskForApproval::to_core);
    let approvals_reviewer = params
        .approvals_reviewer
        .map(protocol::ApprovalsReviewer::to_core);
    let sandbox_policy = params
        .sandbox_policy
        .as_ref()
        .map(protocol::SandboxPolicy::to_core);
    let effort = params.effort.clone().map(Some);
    let overrides = ThreadSettingsOverrides {
        cwd: params.cwd.clone(),
        workspace_roots: runtime_workspace_roots.clone(),
        profile_workspace_roots: None,
        approval_policy,
        approvals_reviewer,
        sandbox_policy: sandbox_policy.clone(),
        permission_profile: None,
        active_permission_profile: None,
        windows_sandbox_level: None,
        model: params.model.clone(),
        effort: effort.clone(),
        summary: params.summary,
        service_tier: params.service_tier.clone(),
        collaboration_mode: params.collaboration_mode.clone(),
        personality: params.personality.clone(),
    };

    if overrides != ThreadSettingsOverrides::default() {
        thread
            .preview_thread_settings_overrides(CodexThreadSettingsOverrides {
                cwd: overrides.cwd.clone(),
                workspace_roots: overrides.workspace_roots.clone(),
                profile_workspace_roots: overrides.profile_workspace_roots.clone(),
                approval_policy: overrides.approval_policy,
                approvals_reviewer: overrides.approvals_reviewer,
                sandbox_policy: sandbox_policy.clone(),
                permission_profile: None,
                active_permission_profile: None,
                windows_sandbox_level: None,
                model: overrides.model.clone(),
                effort: effort.clone(),
                summary: overrides.summary,
                service_tier: overrides.service_tier.clone(),
                collaboration_mode: overrides.collaboration_mode.clone(),
                personality: overrides.personality.clone(),
            })
            .await
            .map_err(to_js_error)?;
    }

    Ok(overrides)
}

#[cfg(feature = "real-codex")]
fn thread_list_result(
    state: &Rc<RefCell<BrowserProtocolState>>,
    params: protocol::ThreadListParams,
) -> Result<serde_json::Value, JsValue> {
    let state = state.borrow();
    let mut ids = state.loaded_thread_ids.clone();
    ids.reverse();
    let (ids, next_cursor) = paginate_ids(&ids, params.cursor, params.limit);
    let data = ids
        .into_iter()
        .filter_map(|id| state.threads.get(&id).map(|thread| thread.thread.clone()))
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "data": data,
        "nextCursor": next_cursor,
        "backwardsCursor": null,
    }))
}

#[cfg(feature = "real-codex")]
fn thread_search_result(
    state: &Rc<RefCell<BrowserProtocolState>>,
    params: protocol::ThreadSearchParams,
) -> Result<serde_json::Value, JsValue> {
    let state = state.borrow();
    let query = params.search_term.to_lowercase();
    let mut ids = state.loaded_thread_ids.clone();
    ids.reverse();
    let ids = ids
        .into_iter()
        .filter(|id| {
            let Some(thread) = state.threads.get(id) else {
                return false;
            };
            let haystack = format!(
                "{} {}",
                thread.thread["preview"].as_str().unwrap_or_default(),
                thread.thread["name"].as_str().unwrap_or_default()
            )
            .to_lowercase();
            query.is_empty() || haystack.contains(&query) || id.to_lowercase().contains(&query)
        })
        .collect::<Vec<_>>();
    let (ids, next_cursor) = paginate_ids(&ids, params.cursor, params.limit);
    let data = ids
        .into_iter()
        .filter_map(|id| {
            state.threads.get(&id).map(|thread| {
                serde_json::json!({
                    "thread": thread.thread.clone(),
                    "snippet": thread.thread["preview"].as_str().unwrap_or_default(),
                })
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "data": data,
        "nextCursor": next_cursor,
        "backwardsCursor": null,
    }))
}

#[cfg(feature = "real-codex")]
fn thread_loaded_list_result(
    state: &Rc<RefCell<BrowserProtocolState>>,
    params: protocol::ThreadLoadedListParams,
) -> serde_json::Value {
    let state = state.borrow();
    let (data, next_cursor) = paginate_ids(&state.loaded_thread_ids, params.cursor, params.limit);
    serde_json::json!({
        "data": data,
        "nextCursor": next_cursor,
    })
}

#[cfg(feature = "real-codex")]
fn browser_thread_json(thread: &BrowserThread, include_turns: bool) -> serde_json::Value {
    let mut thread_json = thread.thread.clone();
    thread_json["turns"] = if include_turns {
        serde_json::json!(turns_from_events(&thread.events))
    } else {
        serde_json::json!([])
    };
    thread_json
}

#[cfg(feature = "real-codex")]
fn paginate_ids(
    ids: &[String],
    cursor: Option<String>,
    limit: Option<u32>,
) -> (Vec<String>, Option<String>) {
    let start = cursor
        .and_then(|cursor| cursor.parse::<usize>().ok())
        .unwrap_or(0)
        .min(ids.len());
    let remaining = ids.len().saturating_sub(start);
    let limit = limit
        .map(|limit| limit as usize)
        .filter(|limit| *limit > 0)
        .unwrap_or(remaining);
    let end = start.saturating_add(limit).min(ids.len());
    let next_cursor = if end < ids.len() {
        Some(end.to_string())
    } else {
        None
    };
    (ids[start..end].to_vec(), next_cursor)
}

#[cfg(feature = "real-codex")]
fn paginate_values(
    values: &[serde_json::Value],
    cursor: Option<String>,
    limit: Option<u32>,
) -> (Vec<serde_json::Value>, Option<String>) {
    let start = cursor
        .and_then(|cursor| cursor.parse::<usize>().ok())
        .unwrap_or(0)
        .min(values.len());
    let remaining = values.len().saturating_sub(start);
    let limit = limit
        .map(|limit| limit as usize)
        .filter(|limit| *limit > 0)
        .unwrap_or(remaining);
    let end = start.saturating_add(limit).min(values.len());
    let next_cursor = if end < values.len() {
        Some(end.to_string())
    } else {
        None
    };
    (values[start..end].to_vec(), next_cursor)
}

#[cfg(feature = "real-codex")]
fn sandbox_policy_json(sandbox: Option<protocol::SandboxMode>) -> serde_json::Value {
    match sandbox.unwrap_or(protocol::SandboxMode::DangerFullAccess) {
        protocol::SandboxMode::ReadOnly => serde_json::json!({
            "type": "readOnly",
            "networkAccess": false,
        }),
        protocol::SandboxMode::WorkspaceWrite => serde_json::json!({
            "type": "workspaceWrite",
            "writableRoots": [],
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false,
        }),
        protocol::SandboxMode::DangerFullAccess => serde_json::json!({
            "type": "dangerFullAccess",
        }),
    }
}

#[cfg(feature = "real-codex")]
fn normalize_browser_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return "/".to_string();
    }
    if trimmed.starts_with('/') {
        return trimmed.to_string();
    }
    format!("/{}", trimmed.trim_start_matches("./"))
}

#[cfg(feature = "real-codex")]
fn post_thread_started_notification(
    port: &MessagePort,
    thread: serde_json::Value,
) -> Result<(), JsValue> {
    post_json_notification(
        port,
        "thread/started",
        serde_json::json!({ "thread": thread }),
    )
}

#[cfg(feature = "real-codex")]
fn post_json_notification(
    port: &MessagePort,
    method: &str,
    params: serde_json::Value,
) -> Result<(), JsValue> {
    let notification = Object::new();
    set(&notification, "method", method);
    let params = params
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_error)?;
    set_value(&notification, "params", params);
    port.post_message(&notification)
}

#[cfg(feature = "real-codex")]
fn post_protocol_notification(
    port: &MessagePort,
    notification: protocol::ServerNotification,
) -> Result<(), JsValue> {
    let value = notification
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_error)?;
    port.post_message(&value)
}

#[cfg(feature = "real-codex")]
fn browser_epoch_seconds() -> i64 {
    (js_sys::Date::now() / 1000.0).floor() as i64
}

#[cfg(feature = "real-codex")]
fn request_host_fs_read_file(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::FsReadFileParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "path", &path_to_string(&params.path));
    set(&host_params, "encoding", "base64");
    queue_host_request(
        port,
        state,
        "fs/readFile",
        host_params.into(),
        PendingHostRequest::FsReadFile { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_fs_write_file(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::FsWriteFileParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "path", &path_to_string(&params.path));
    set(&host_params, "content", &params.data_base64);
    set(&host_params, "encoding", "base64");
    queue_host_request(
        port,
        state,
        "fs/writeFile",
        host_params.into(),
        PendingHostRequest::FsWriteFile { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_fs_create_directory(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::FsCreateDirectoryParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "path", &path_to_string(&params.path));
    if let Some(recursive) = params.recursive {
        set_bool(&host_params, "recursive", recursive);
    }
    queue_host_request(
        port,
        state,
        "fs/createDirectory",
        host_params.into(),
        PendingHostRequest::FsCreateDirectory { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_fs_read_directory(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::FsReadDirectoryParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "path", &path_to_string(&params.path));
    queue_host_request(
        port,
        state,
        "fs/readDirectory",
        host_params.into(),
        PendingHostRequest::FsReadDirectory { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_fs_get_metadata(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::FsGetMetadataParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "path", &path_to_string(&params.path));
    queue_host_request(
        port,
        state,
        "fs/getMetadata",
        host_params.into(),
        PendingHostRequest::FsGetMetadata { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_command_exec(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::CommandExecParams,
) -> Result<(), JsValue> {
    if params.command.is_empty() {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser command/exec requires a non-empty command argv.",
        );
    }

    let requires_client_process_id =
        params.tty || params.stream_stdin || params.stream_stdout_stderr;
    if requires_client_process_id && params.process_id.is_none() {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser command/exec tty or streaming requires a client-supplied processId.",
        );
    }

    if params.output_bytes_cap.is_some()
        || params.disable_output_cap
        || params.sandbox_policy.is_some()
        || params.permission_profile.is_some()
    {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser command/exec does not yet support output caps, sandbox policies, or permission profiles.",
        );
    }

    let host_params = Object::new();
    let command = Array::new();
    for arg in params.command {
        command.push(&JsValue::from_str(&arg));
    }
    set_value(&host_params, "command", command.into());

    let streamed = params.tty || params.stream_stdout_stderr;
    if let Some(process_id) = params.process_id {
        set(&host_params, "processId", &process_id);
    }

    if params.tty {
        set_bool(&host_params, "tty", true);
    }

    if params.tty || params.stream_stdin {
        set_bool(&host_params, "streamStdin", true);
    }

    if params.tty || params.stream_stdout_stderr {
        set_bool(&host_params, "streamStdoutStderr", true);
    }

    if let Some(size) = params.size {
        let host_size = Object::new();
        set_value(&host_size, "cols", JsValue::from_f64(size.cols as f64));
        set_value(&host_size, "rows", JsValue::from_f64(size.rows as f64));
        set_value(&host_params, "size", host_size.into());
    }

    if let Some(cwd) = params.cwd {
        set(&host_params, "cwd", &cwd.to_string_lossy());
    }

    if let Some(env) = params.env {
        let host_env = Object::new();
        let mut has_env = false;
        for (key, value) in env {
            if let Some(value) = value {
                set(&host_env, &key, &value);
                has_env = true;
            }
        }
        if has_env {
            set_value(&host_params, "env", host_env.into());
        }
    }

    if !params.disable_timeout {
        if let Some(timeout_ms) = params.timeout_ms {
            set_value(
                &host_params,
                "timeoutMs",
                JsValue::from_f64(timeout_ms as f64),
            );
        }
    }

    queue_host_request(
        port,
        state,
        "command/exec",
        host_params.into(),
        PendingHostRequest::CommandExec {
            request_id,
            streamed,
        },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_command_write(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::CommandExecWriteParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "processId", &params.process_id);
    if let Some(delta_base64) = params.delta_base64 {
        set(&host_params, "deltaBase64", &delta_base64);
    }
    if params.close_stdin {
        set_bool(&host_params, "closeStdin", true);
    }
    queue_host_request(
        port,
        state,
        "command/write",
        host_params.into(),
        PendingHostRequest::CommandExecWrite { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_command_terminate(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::CommandExecTerminateParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "processId", &params.process_id);
    queue_host_request(
        port,
        state,
        "command/terminate",
        host_params.into(),
        PendingHostRequest::CommandExecTerminate { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_command_resize(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::CommandExecResizeParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "processId", &params.process_id);
    set_value(
        &host_params,
        "cols",
        JsValue::from_f64(params.size.cols as f64),
    );
    set_value(
        &host_params,
        "rows",
        JsValue::from_f64(params.size.rows as f64),
    );
    queue_host_request(
        port,
        state,
        "command/resize",
        host_params.into(),
        PendingHostRequest::CommandExecResize { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_process_spawn(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ProcessSpawnParams,
) -> Result<(), JsValue> {
    if params.command.is_empty() {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser process/spawn requires a non-empty command argv.",
        );
    }

    if params.process_handle.is_empty() {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser process/spawn requires a non-empty processHandle.",
        );
    }

    if params.size.is_some() && !params.tty {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser process/spawn size requires tty: true.",
        );
    }

    if params.output_bytes_cap.is_some() {
        return post_error_response(
            port,
            request_id_to_js_value(&request_id),
            -32602,
            "browser process/spawn does not yet support outputBytesCap.",
        );
    }

    let host_params = Object::new();
    let command = Array::new();
    for arg in params.command {
        command.push(&JsValue::from_str(&arg));
    }
    set_value(&host_params, "command", command.into());
    set(&host_params, "processHandle", &params.process_handle);
    set(&host_params, "cwd", &path_to_string(&params.cwd));

    if params.tty {
        set_bool(&host_params, "tty", true);
    }

    if params.tty || params.stream_stdin {
        set_bool(&host_params, "streamStdin", true);
    }

    if params.tty || params.stream_stdout_stderr {
        set_bool(&host_params, "streamStdoutStderr", true);
    }

    if let Some(size) = params.size {
        let host_size = Object::new();
        set_value(&host_size, "cols", JsValue::from_f64(size.cols as f64));
        set_value(&host_size, "rows", JsValue::from_f64(size.rows as f64));
        set_value(&host_params, "size", host_size.into());
    }

    if let Some(env) = params.env {
        let host_env = Object::new();
        let mut has_env = false;
        for (key, value) in env {
            if let Some(value) = value {
                set(&host_env, &key, &value);
                has_env = true;
            }
        }
        if has_env {
            set_value(&host_params, "env", host_env.into());
        }
    }

    if let Some(Some(timeout_ms)) = params.timeout_ms {
        if timeout_ms < 0 {
            return post_error_response(
                port,
                request_id_to_js_value(&request_id),
                -32602,
                "browser process/spawn timeoutMs must be non-negative.",
            );
        }
        set_value(
            &host_params,
            "timeoutMs",
            JsValue::from_f64(timeout_ms as f64),
        );
    }

    queue_host_request(
        port,
        state,
        "process/spawn",
        host_params.into(),
        PendingHostRequest::ProcessSpawn { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_process_write_stdin(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ProcessWriteStdinParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "processHandle", &params.process_handle);
    if let Some(delta_base64) = params.delta_base64 {
        set(&host_params, "deltaBase64", &delta_base64);
    }
    if params.close_stdin {
        set_bool(&host_params, "closeStdin", true);
    }
    queue_host_request(
        port,
        state,
        "process/writeStdin",
        host_params.into(),
        PendingHostRequest::ProcessWriteStdin { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_process_kill(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ProcessKillParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "processHandle", &params.process_handle);
    queue_host_request(
        port,
        state,
        "process/kill",
        host_params.into(),
        PendingHostRequest::ProcessKill { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn request_host_process_resize_pty(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ProcessResizePtyParams,
) -> Result<(), JsValue> {
    let host_params = Object::new();
    set(&host_params, "processHandle", &params.process_handle);
    set_value(
        &host_params,
        "cols",
        JsValue::from_f64(params.size.cols as f64),
    );
    set_value(
        &host_params,
        "rows",
        JsValue::from_f64(params.size.rows as f64),
    );
    queue_host_request(
        port,
        state,
        "process/resizePty",
        host_params.into(),
        PendingHostRequest::ProcessResizePty { request_id },
    )
}

#[cfg(feature = "real-codex")]
fn queue_host_request(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    op: &str,
    params: JsValue,
    pending: PendingHostRequest,
) -> Result<(), JsValue> {
    let host_request_id = {
        let mut state = state.borrow_mut();
        state.next_host_request_id += 1;
        let host_request_id = format!("codex_app_server_{}", state.next_host_request_id);
        state
            .pending_host_requests
            .insert(host_request_id.clone(), pending);
        host_request_id
    };

    let message = Object::new();
    set(&message, "type", "codex/host/request");
    set(&message, "id", &host_request_id);
    set(&message, "op", op);
    set_value(&message, "params", params);

    match port.post_message(&message) {
        Ok(()) => Ok(()),
        Err(error) => {
            state
                .borrow_mut()
                .pending_host_requests
                .remove(&host_request_id);
            Err(error)
        }
    }
}

#[cfg(feature = "real-codex")]
fn handle_host_event(port: &MessagePort, data: JsValue) -> Result<(), JsValue> {
    #[cfg(target_arch = "wasm32")]
    if codex_exec_server::handle_wasm_host_process_event(data.clone()) {
        return Ok(());
    }
    let event = Reflect::get(&data, &JsValue::from_str("event"))?
        .as_string()
        .unwrap_or_default();
    let params = Reflect::get(&data, &JsValue::from_str("params"))?;
    match event.as_str() {
        "command/outputDelta" => {
            post_output_delta_notification(port, "command/exec/outputDelta", "processId", &params)
        }
        "process/outputDelta" => {
            post_output_delta_notification(port, "process/outputDelta", "processHandle", &params)
        }
        "process/exited" => post_process_exited_notification(port, &params),
        _ => Ok(()),
    }
}

#[cfg(feature = "real-codex")]
fn post_output_delta_notification(
    port: &MessagePort,
    method: &str,
    handle_key: &str,
    params: &JsValue,
) -> Result<(), JsValue> {
    let handle = Reflect::get(params, &JsValue::from_str(handle_key))?
        .as_string()
        .unwrap_or_default();
    let stream = Reflect::get(params, &JsValue::from_str("stream"))?
        .as_string()
        .unwrap_or_default();
    let delta_base64 = Reflect::get(params, &JsValue::from_str("deltaBase64"))?
        .as_string()
        .or_else(|| {
            Reflect::get(params, &JsValue::from_str("data"))
                .ok()
                .and_then(|value| value.as_string())
        })
        .unwrap_or_default();
    let cap_reached = Reflect::get(params, &JsValue::from_str("capReached"))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if handle.is_empty() || delta_base64.is_empty() || (stream != "stdout" && stream != "stderr") {
        return Ok(());
    }

    let notification = Object::new();
    set(&notification, "method", method);
    let notification_params = Object::new();
    set(&notification_params, handle_key, &handle);
    set(&notification_params, "stream", &stream);
    set(&notification_params, "deltaBase64", &delta_base64);
    set_bool(&notification_params, "capReached", cap_reached);
    set_value(&notification, "params", notification_params.into());
    port.post_message(&notification)
}

#[cfg(feature = "real-codex")]
fn post_process_exited_notification(port: &MessagePort, params: &JsValue) -> Result<(), JsValue> {
    let process_handle = Reflect::get(params, &JsValue::from_str("processHandle"))?
        .as_string()
        .unwrap_or_default();
    if process_handle.is_empty() {
        return Ok(());
    }

    let notification = Object::new();
    set(&notification, "method", "process/exited");
    let notification_params = Object::new();
    set(&notification_params, "processHandle", &process_handle);
    set_value(
        &notification_params,
        "exitCode",
        JsValue::from_f64(
            Reflect::get(params, &JsValue::from_str("exitCode"))?
                .as_f64()
                .unwrap_or(0.0),
        ),
    );
    set(
        &notification_params,
        "stdout",
        &Reflect::get(params, &JsValue::from_str("stdout"))?
            .as_string()
            .unwrap_or_default(),
    );
    set_bool(
        &notification_params,
        "stdoutCapReached",
        Reflect::get(params, &JsValue::from_str("stdoutCapReached"))
            .ok()
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    );
    set(
        &notification_params,
        "stderr",
        &Reflect::get(params, &JsValue::from_str("stderr"))?
            .as_string()
            .unwrap_or_default(),
    );
    set_bool(
        &notification_params,
        "stderrCapReached",
        Reflect::get(params, &JsValue::from_str("stderrCapReached"))
            .ok()
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    );
    set_value(&notification, "params", notification_params.into());
    port.post_message(&notification)
}

#[cfg(feature = "real-codex")]
fn handle_host_response(
    port: &MessagePort,
    data: JsValue,
    state: &Rc<RefCell<BrowserProtocolState>>,
) -> Result<(), JsValue> {
    let host_request_id = Reflect::get(&data, &JsValue::from_str("id"))?
        .as_string()
        .unwrap_or_default();
    let Some(pending) = state
        .borrow_mut()
        .pending_host_requests
        .remove(&host_request_id)
    else {
        return Ok(());
    };

    if let Some(message) = host_response_error_message(&data)? {
        return post_error_response(
            port,
            request_id_to_js_value(pending.request_id()),
            -32000,
            &message,
        );
    }

    let result = Reflect::get(&data, &JsValue::from_str("result"))?;
    match pending {
        PendingHostRequest::FsReadFile { request_id } => {
            let result: HostReadFileResult =
                serde_wasm_bindgen::from_value(result).map_err(to_js_error)?;
            if result.encoding.as_deref() != Some("base64") {
                return post_error_response(
                    port,
                    request_id_to_js_value(&request_id),
                    -32603,
                    "host fs/readFile did not return base64 data",
                );
            }
            post_protocol_response(port, request_id, protocol::FsReadFileResponse {
                data_base64: result.content,
            })
        }
        PendingHostRequest::FsWriteFile { request_id } => {
            post_protocol_json_response(port, request_id, serde_json::json!({}))
        }
        PendingHostRequest::FsCreateDirectory { request_id } => {
            post_protocol_json_response(port, request_id, serde_json::json!({}))
        }
        PendingHostRequest::FsReadDirectory { request_id } => {
            let result: HostReadDirectoryResult =
                serde_wasm_bindgen::from_value(result).map_err(to_js_error)?;
            let entries = result
                .entries
                .into_iter()
                .map(|entry| protocol::FsReadDirectoryEntry {
                    file_name: entry.name,
                    is_directory: entry.entry_type == "directory",
                    is_file: entry.entry_type == "file",
                })
                .collect();
            post_protocol_response(port, request_id, protocol::FsReadDirectoryResponse {
                entries,
            })
        }
        PendingHostRequest::FsGetMetadata { request_id } => {
            let result: HostMetadataResult =
                serde_wasm_bindgen::from_value(result).map_err(to_js_error)?;
            post_protocol_response(port, request_id, protocol::FsGetMetadataResponse {
                is_directory: result.entry_type == "directory",
                is_file: result.entry_type == "file",
                is_symlink: false,
                created_at_ms: 0,
                modified_at_ms: result.mtime_ms.round() as i64,
            })
        }
        PendingHostRequest::CommandExec {
            request_id,
            streamed,
        } => {
            let result: HostCommandExecResult =
                serde_wasm_bindgen::from_value(result).map_err(to_js_error)?;
            post_protocol_response(port, request_id, protocol::CommandExecResponse {
                exit_code: result.exit_code,
                stdout: if streamed {
                    String::new()
                } else {
                    result.stdout
                },
                stderr: if streamed {
                    String::new()
                } else {
                    result.stderr
                },
            })
        }
        PendingHostRequest::CommandExecWrite { request_id }
        | PendingHostRequest::CommandExecTerminate { request_id }
        | PendingHostRequest::CommandExecResize { request_id }
        | PendingHostRequest::ProcessSpawn { request_id }
        | PendingHostRequest::ProcessWriteStdin { request_id }
        | PendingHostRequest::ProcessKill { request_id }
        | PendingHostRequest::ProcessResizePty { request_id } => {
            post_protocol_json_response(port, request_id, serde_json::json!({}))
        }
    }
}

#[cfg(feature = "real-codex")]
impl PendingHostRequest {
    fn request_id(&self) -> &protocol::RequestId {
        match self {
            Self::FsReadFile { request_id }
            | Self::FsWriteFile { request_id }
            | Self::FsCreateDirectory { request_id }
            | Self::FsReadDirectory { request_id }
            | Self::FsGetMetadata { request_id }
            | Self::CommandExec { request_id, .. }
            | Self::CommandExecWrite { request_id }
            | Self::CommandExecTerminate { request_id }
            | Self::CommandExecResize { request_id }
            | Self::ProcessSpawn { request_id }
            | Self::ProcessWriteStdin { request_id }
            | Self::ProcessKill { request_id }
            | Self::ProcessResizePty { request_id } => request_id,
        }
    }
}

#[cfg(feature = "real-codex")]
fn host_response_error_message(data: &JsValue) -> Result<Option<String>, JsValue> {
    let error = Reflect::get(data, &JsValue::from_str("error"))?;
    if error.is_null() || error.is_undefined() {
        return Ok(None);
    }
    let message = Reflect::get(&error, &JsValue::from_str("message"))?
        .as_string()
        .unwrap_or_else(|| "host bridge request failed".to_string());
    Ok(Some(message))
}

#[cfg(feature = "real-codex")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostReadFileResult {
    content: String,
    encoding: Option<String>,
}

#[cfg(feature = "real-codex")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostReadDirectoryResult {
    entries: Vec<HostReadDirectoryEntry>,
}

#[cfg(feature = "real-codex")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostReadDirectoryEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[cfg(feature = "real-codex")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostMetadataResult {
    #[serde(rename = "type")]
    entry_type: String,
    mtime_ms: f64,
}

#[cfg(feature = "real-codex")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostCommandExecResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[cfg(not(feature = "real-codex"))]
fn handle_protocol_request(
    port: &MessagePort,
    data: JsValue,
    _state: &Rc<RefCell<BrowserProtocolState>>,
) -> Result<(), JsValue> {
    let id = Reflect::get(&data, &JsValue::from_str("id"))?;
    let method = Reflect::get(&data, &JsValue::from_str("method"))?
        .as_string()
        .unwrap_or_default();
    post_error_response(
        port,
        id,
        -32601,
        &format!("Codex browser app-server received `{method}`, but real-codex is disabled."),
    )
}

#[cfg(feature = "real-codex")]
fn initialize_result() -> serde_json::Value {
    serde_json::json!({
        "userAgent": format!("almostnode-codex-wasm/{}", env!("CARGO_PKG_VERSION")),
        "codexHome": "/codex-browser-home",
        "platformFamily": "wasm",
        "platformOs": "browser",
    })
}

#[cfg(feature = "real-codex")]
fn path_to_string(path: &impl AsRef<std::path::Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

#[cfg(feature = "real-codex")]
fn post_protocol_response(
    port: &MessagePort,
    id: protocol::RequestId,
    result: impl Serialize,
) -> Result<(), JsValue> {
    let result = serde_json::to_value(result).map_err(to_js_error)?;
    post_protocol_json_response(port, id, result)
}

#[cfg(feature = "real-codex")]
fn post_protocol_json_response(
    port: &MessagePort,
    id: protocol::RequestId,
    result: serde_json::Value,
) -> Result<(), JsValue> {
    let response = jsonrpc_response_value(id, result)?;
    port.post_message(&response)
}

#[cfg(feature = "real-codex")]
fn jsonrpc_response_value(
    id: protocol::RequestId,
    result: serde_json::Value,
) -> Result<JsValue, JsValue> {
    protocol::JSONRPCResponse { id, result }
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(to_js_error)
}

#[cfg(feature = "real-codex")]
fn request_id_to_js_value(id: &protocol::RequestId) -> JsValue {
    match id {
        protocol::RequestId::String(value) => JsValue::from_str(value),
        protocol::RequestId::Integer(value) => JsValue::from_f64(*value as f64),
    }
}

#[cfg(feature = "real-codex")]
fn to_js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[cfg(feature = "real-codex")]
fn js_error_to_string(error: JsValue) -> String {
    error.as_string().unwrap_or_else(|| format!("{error:?}"))
}

fn status_result(state: &Rc<RefCell<BrowserProtocolState>>) -> JsValue {
    let state = state.borrow();
    let result = Object::new();
    set(&result, "status", "ready");
    set(&result, "runtime", "browser-wasm");
    set_bool(&result, "realCodexLinked", cfg!(feature = "real-codex"));
    set_bool(&result, "nativeMessageProcessor", false);
    set_bool(&result, "coreThreadRuntime", cfg!(feature = "real-codex"));
    set_bool(&result, "protocolBackedReads", cfg!(feature = "real-codex"));
    #[cfg(feature = "real-codex")]
    set_value(
        &result,
        "loadedThreadCount",
        JsValue::from_f64(state.loaded_thread_ids.len() as f64),
    );
    #[cfg(not(feature = "real-codex"))]
    set_value(&result, "loadedThreadCount", JsValue::from_f64(0.0));
    #[cfg(feature = "real-codex")]
    set_value(
        &result,
        "hostBridgeRequestsInFlight",
        JsValue::from_f64(state.pending_host_requests.len() as f64),
    );
    #[cfg(not(feature = "real-codex"))]
    set_value(
        &result,
        "hostBridgeRequestsInFlight",
        JsValue::from_f64(0.0),
    );
    set_bool(&result, "initializeSeen", state.initialize_seen);
    set_bool(&result, "initialized", state.initialized);
    set(
        &result,
        "message",
        "The Codex app-server WASM adapter is running with upstream Codex ThreadManager/CodexThread, \
         host-backed filesystem/process/http/auth shims, protocol-backed thread reads, and real core \
         turn execution. The native MessageProcessor transport is still represented by this wasm adapter boundary.",
    );
    result.into()
}

fn post_response(port: &MessagePort, id: JsValue, result: JsValue) -> Result<(), JsValue> {
    let response = Object::new();
    set_value(&response, "id", id);
    set_value(&response, "result", result);
    port.post_message(&response)
}

fn post_error_response(
    port: &MessagePort,
    id: JsValue,
    code: i32,
    message: &str,
) -> Result<(), JsValue> {
    let response = Object::new();
    set_value(&response, "id", id);
    set_value(&response, "error", json_rpc_error(code, message));
    port.post_message(&response)
}

fn post_error_notification(port: &MessagePort, error: JsValue) -> Result<(), JsValue> {
    let notification = Object::new();
    set(&notification, "method", "appServer/error");
    let params = Object::new();
    set_value(&params, "message", error);
    set_value(&notification, "params", params.into());
    port.post_message(&notification)
}

fn json_rpc_error(code: i32, message: &str) -> JsValue {
    let error = Object::new();
    set_value(&error, "code", JsValue::from_f64(f64::from(code)));
    set(&error, "message", message);
    error.into()
}

fn set(object: &Object, key: &str, value: &str) {
    set_value(object, key, JsValue::from_str(value));
}

fn set_bool(object: &Object, key: &str, value: bool) {
    set_value(object, key, JsValue::from_bool(value));
}

fn set_value(object: &Object, key: &str, value: JsValue) {
    Reflect::set(object, &JsValue::from_str(key), &value)
        .expect("setting property on a JavaScript object should not fail");
}
