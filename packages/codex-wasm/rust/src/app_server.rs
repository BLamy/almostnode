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
use std::sync::Weak;

#[cfg(feature = "real-codex")]
use codex_app_server::protocol;
#[cfg(feature = "real-codex")]
use codex_cli::CODEX_CLI_VERSION;
#[cfg(feature = "real-codex")]
use codex_core::config::Config;
#[cfg(feature = "real-codex")]
use codex_core::config::ConfigBuilder;
#[cfg(feature = "real-codex")]
use codex_core::config::ConfigOverrides;
#[cfg(feature = "real-codex")]
use codex_core::config::ThreadStoreConfig;
#[cfg(feature = "real-codex")]
use codex_core::thread_store_from_config;
#[cfg(feature = "real-codex")]
use codex_core::CodexThread;
#[cfg(feature = "real-codex")]
use codex_core::CodexThreadSettingsOverrides;
#[cfg(feature = "real-codex")]
use codex_core::NewThread;
#[cfg(feature = "real-codex")]
use codex_core::StartThreadOptions;
#[cfg(feature = "real-codex")]
use codex_core::ThreadManager;
#[cfg(feature = "real-codex")]
use codex_exec_server::EnvironmentManager;
#[cfg(feature = "real-codex")]
use codex_exec_server::LOCAL_ENVIRONMENT_ID;
#[cfg(feature = "real-codex")]
use codex_extension_api::AgentSpawnFuture;
#[cfg(feature = "real-codex")]
use codex_extension_api::AgentSpawner;
#[cfg(feature = "real-codex")]
use codex_extension_api::ExtensionRegistry;
#[cfg(feature = "real-codex")]
use codex_extension_api::ExtensionRegistryBuilder;
#[cfg(feature = "real-codex")]
use codex_login::AuthManager;
#[cfg(feature = "real-codex")]
use codex_login::CodexAuth;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuth;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuthFuture;
#[cfg(feature = "real-codex")]
use codex_login::ExternalAuthRefreshContext;
#[cfg(feature = "real-codex")]
use codex_protocol::error::CodexErr;
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
use codex_protocol::protocol::TurnEnvironmentSelections;
#[cfg(feature = "real-codex")]
use codex_protocol::ThreadId;
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
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
#[cfg(feature = "real-codex")]
use wasm_bindgen_futures::JsFuture;
use web_sys::MessageEvent;
use web_sys::MessagePort;

const BROWSER_CODEX_HOME: &str = "/home/user/.codex";

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
struct BrowserCodexAuthState {
    access_token: String,
    account_id: String,
    plan_type: Option<String>,
}

#[cfg(feature = "real-codex")]
#[derive(Debug)]
struct BrowserCodexExternalAuth {
    state: std::sync::RwLock<BrowserCodexAuthState>,
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
impl ExternalAuth for BrowserCodexExternalAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|_| std::io::Error::other("Codex browser auth state is poisoned"))?
                .clone();
            browser_codex_auth(&state)
        })
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async move {
            // host_request_json's future is !Send (it holds JsValues), but the
            // ExternalAuth trait requires Send futures — bounce through
            // spawn_local and a oneshot channel to keep this future Send.
            let (tx, rx) = tokio::sync::oneshot::channel::<Result<BrowserCodexAuthState, String>>();
            wasm_bindgen_futures::spawn_local(async move {
                let result = host_request_json::<HostAuthEnvResult, _>(
                    "auth/refresh",
                    &serde_json::json!({ "reason": "unauthorized" }),
                )
                .await
                .map_err(|err| format!("{err:?}"))
                .and_then(|result| browser_codex_auth_state(result.env));
                let _ = tx.send(result);
            });

            let refreshed = rx
                .await
                .map_err(|_| std::io::Error::other("auth/refresh host request was dropped"))?
                .map_err(std::io::Error::other)?;
            *self
                .state
                .write()
                .map_err(|_| std::io::Error::other("Codex browser auth state is poisoned"))? =
                refreshed.clone();
            browser_codex_auth(&refreshed)
        })
    }
}

#[cfg(feature = "real-codex")]
fn browser_codex_auth(state: &BrowserCodexAuthState) -> std::io::Result<CodexAuth> {
    CodexAuth::from_external_chatgpt_tokens(
        &state.access_token,
        &state.account_id,
        state.plan_type.as_deref(),
    )
}

#[cfg(feature = "real-codex")]
fn browser_codex_auth_state(env: HashMap<String, String>) -> Result<BrowserCodexAuthState, String> {
    let required = |name: &str| {
        env.get(name)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("auth host shim did not return {name}"))
    };
    Ok(BrowserCodexAuthState {
        access_token: required("CODEX_ACCESS_TOKEN")?,
        account_id: required("CODEX_CHATGPT_ACCOUNT_ID")?,
        plan_type: env
            .get("CODEX_CHATGPT_PLAN_TYPE")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
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
        protocol::ClientRequest::ThreadItemsList { request_id, params } => {
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
fn browser_extension_registry(
    thread_manager: Weak<ThreadManager>,
    auth_manager: Arc<AuthManager>,
    environment_manager: Arc<EnvironmentManager>,
    session_source: SessionSource,
) -> Arc<ExtensionRegistry<Config>> {
    let mut builder = ExtensionRegistryBuilder::<Config>::new();

    codex_guardian::install(&mut builder, browser_guardian_agent_spawner(thread_manager));
    codex_memories_extension::install(&mut builder, /*metrics_client*/ None);
    codex_mcp_extension::install(&mut builder);
    codex_mcp_extension::install_executor_plugins(&mut builder, Arc::clone(&environment_manager));
    codex_web_search_extension::install(&mut builder, Arc::clone(&auth_manager));
    codex_image_generation_extension::install(&mut builder, auth_manager, |config: &Config| {
        Some(config.codex_home.clone())
    });

    let executor_skill_provider: Arc<dyn codex_skills_extension::SkillProvider> = Arc::new(
        codex_skills_extension::ExecutorSkillProvider::new_with_restriction_product(
            environment_manager,
            session_source.restriction_product(),
        ),
    );
    let skill_providers = codex_skills_extension::SkillProviders::new()
        .with_executor_provider(executor_skill_provider)
        .with_orchestrator_provider(Arc::new(
            codex_skills_extension::OrchestratorSkillProvider::new(),
        ))
        .with_host_provider(Arc::new(codex_skills_extension::HostSkillProvider::new()));
    codex_skills_extension::install_with_providers(
        &mut builder,
        skill_providers,
        |config: &Config| codex_skills_extension::SkillsExtensionConfig {
            include_instructions: config.include_skill_instructions,
            bundled_skills_enabled: config.bundled_skills_enabled(),
            orchestrator_skills_enabled: config.orchestrator_skills_enabled,
            shadow_selection_enabled: config
                .features
                .enabled(codex_features::Feature::SkillSearch),
        },
    );

    Arc::new(builder.build())
}

#[cfg(feature = "real-codex")]
fn browser_guardian_agent_spawner(
    thread_manager: Weak<ThreadManager>,
) -> impl AgentSpawner<StartThreadOptions, Spawned = NewThread, Error = CodexErr> {
    move |forked_from_thread_id: ThreadId,
          options: StartThreadOptions|
          -> AgentSpawnFuture<'static, NewThread, CodexErr> {
        let thread_manager = thread_manager.clone();
        Box::pin(async move {
            let thread_manager = thread_manager.upgrade().ok_or_else(|| {
                CodexErr::UnsupportedOperation("thread manager dropped".to_string())
            })?;
            thread_manager
                .spawn_subagent(forked_from_thread_id, options)
                .await
        })
    }
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
        .codex_home(PathBuf::from(BROWSER_CODEX_HOME))
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
    let session_source = SessionSource::Custom("appServer".to_string());
    let thread_manager = Arc::new_cyclic(|thread_manager| {
        ThreadManager::new(
            &config,
            Arc::clone(&auth_manager),
            codex_core::build_models_manager(&config, Arc::clone(&auth_manager)),
            codex_core::CodexAppsToolsCache::default(),
            session_source.clone(),
            Arc::clone(&environment_manager),
            browser_extension_registry(
                thread_manager.clone(),
                Arc::clone(&auth_manager),
                Arc::clone(&environment_manager),
                session_source.clone(),
            ),
            Arc::new(codex_home::CodexHomeUserInstructionsProvider::new(
                config.codex_home.clone(),
            )),
            /*analytics_events_client*/ None,
            Arc::clone(&thread_store),
            /*agent_graph_store*/ None,
            uuid::Uuid::new_v4().to_string(),
            /*attestation_provider*/ None,
            /*external_time_provider*/ None,
        )
    });
    trace_app_server_stage("thread/start: resolving environments");
    let environments = match params.environments.clone() {
        Some(environments) => {
            let selections = turn_environment_params_to_core(environments)?;
            thread_manager
                .validate_environment_selections(&selections)
                .map_err(to_js_error)?;
            selections
        }
        None => thread_manager.default_environment_selections(&config.cwd, &config.workspace_roots),
    };
    let dynamic_tools = params.dynamic_tools.clone().unwrap_or_default();
    trace_app_server_stage("thread/start: starting upstream CodexThread");
    let new_thread = thread_manager
        .start_thread_with_options(StartThreadOptions {
            config,
            allow_provider_model_fallback: params.allow_provider_model_fallback,
            initial_history: InitialHistory::New,
            history_mode: params.history_mode.map(Into::into),
            session_source: Some(SessionSource::Custom("appServer".to_string())),
            thread_source: params.thread_source.map(Into::into),
            dynamic_tools,
            metrics_service_name: params.service_name.clone(),
            parent_trace: None,
            environments,
            thread_extension_init: codex_extension_api::ExtensionDataInit::default(),
            supports_openai_form_elicitation: false,
        })
        .await
        .map_err(|error| to_js_error(format!("Codex thread start failed: {error}")))?;
    trace_app_server_stage("thread/start: upstream CodexThread started");

    let thread_id = new_thread.thread_id.to_string();
    let config_snapshot = new_thread.thread.config_snapshot().await;
    let instruction_sources = new_thread.thread.legacy_instruction_sources().await;
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
        "extra": null,
        "sessionId": new_thread.session_configured.session_id.to_string(),
        "forkedFromId": new_thread.session_configured.forked_from_id.map(|id| id.to_string()),
        "parentThreadId": new_thread.session_configured.parent_thread_id.map(|id| id.to_string()),
        "preview": "",
        "ephemeral": config_snapshot.ephemeral,
        "historyMode": params.history_mode.unwrap_or_default(),
        "modelProvider": config_snapshot.model_provider_id.clone(),
        "createdAt": created_at,
        "updatedAt": created_at,
        "recencyAt": created_at,
        "status": { "type": "idle" },
        "path": rollout_path,
        "cwd": config_snapshot.cwd().to_string_lossy().into_owned(),
        "cliVersion": CODEX_CLI_VERSION,
        "source": "appServer",
        "canAcceptDirectInput": true,
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
        "cwd": config_snapshot.cwd().to_string_lossy().into_owned(),
        "runtimeWorkspaceRoots": config_snapshot.workspace_roots.iter().map(|path| path.to_string_lossy().into_owned()).collect::<Vec<_>>(),
        "instructionSources": instruction_sources,
        "approvalPolicy": protocol::AskForApproval::from(config_snapshot.approval_policy),
        "approvalsReviewer": protocol::ApprovalsReviewer::from(config_snapshot.approvals_reviewer),
        "sandbox": sandbox,
        "activePermissionProfile": config_snapshot.active_permission_profile,
        "reasoningEffort": config_snapshot.reasoning_effort,
        "multiAgentMode": "explicitRequestOnly",
    });

    {
        let mut state = state.borrow_mut();
        state.thread_manager = Some(Arc::clone(&thread_manager));
        state.loaded_thread_ids.push(thread_id.clone());
        state.threads.insert(
            thread_id.clone(),
            BrowserThread {
                core_thread: Arc::clone(&new_thread.thread),
                thread: start_response["thread"].clone(),
                history: protocol::ThreadHistoryBuilder::new(),
                events: Vec::new(),
            },
        );
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

    let account_id = env
        .get("CODEX_CHATGPT_ACCOUNT_ID")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            JsValue::from_str(
                "CODEX_CHATGPT_ACCOUNT_ID is required for browser-managed ChatGPT auth.",
            )
        })?;
    let auth_manager =
        AuthManager::shared_from_config(config, /*enable_codex_api_key_env*/ false).await;
    auth_manager
        .set_external_auth(Arc::new(BrowserCodexExternalAuth {
            state: std::sync::RwLock::new(BrowserCodexAuthState {
                access_token,
                account_id,
                plan_type: env
                    .get("CODEX_CHATGPT_PLAN_TYPE")
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
            }),
        }))
        .await
        .map_err(|error| to_js_error(format!("Codex external auth setup failed: {error}")))?;
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
) -> Result<Vec<TurnEnvironmentSelection>, JsValue> {
    let mut selections = Vec::with_capacity(environments.len());
    for environment in environments {
        let environment_id = environment.environment_id;
        let cwd = environment.cwd.to_inferred_path_uri().ok_or_else(|| {
            to_js_error(format!(
                "invalid cwd for environment `{environment_id}`: path `{}` does not use absolute POSIX or Windows path syntax",
                environment.cwd
            ))
        })?;
        let workspace_roots = environment
            .runtime_workspace_roots
            .map(|roots| {
                let mut resolved_roots = Vec::new();
                for root in roots {
                    let root = root.to_inferred_path_uri().ok_or_else(|| {
                        to_js_error(format!(
                            "invalid runtime workspace root for environment `{environment_id}`: path `{root}` does not use absolute POSIX or Windows path syntax"
                        ))
                    })?;
                    if !resolved_roots.contains(&root) {
                        resolved_roots.push(root);
                    }
                }
                Ok::<_, JsValue>(resolved_roots)
            })
            .transpose()?
            .unwrap_or_else(|| vec![cwd.clone()]);
        selections.push(TurnEnvironmentSelection {
            environment_id,
            cwd,
            workspace_roots,
        });
    }
    Ok(selections)
}

#[cfg(feature = "real-codex")]
fn map_additional_context(
    additional_context: Option<HashMap<String, protocol::AdditionalContextEntry>>,
) -> BTreeMap<String, CoreAdditionalContextEntry> {
    additional_context
        .unwrap_or_default()
        .into_iter()
        .map(|(key, entry)| {
            (
                key,
                CoreAdditionalContextEntry {
                    value: entry.value,
                    kind: match entry.kind {
                        protocol::AdditionalContextKind::Untrusted => {
                            CoreAdditionalContextKind::Untrusted
                        }
                        protocol::AdditionalContextKind::Application => {
                            CoreAdditionalContextKind::Application
                        }
                    },
                },
            )
        })
        .collect()
}

#[cfg(feature = "real-codex")]
fn resolve_runtime_workspace_roots(workspace_roots: Vec<AbsolutePathBuf>) -> Vec<AbsolutePathBuf> {
    let mut resolved_roots = Vec::new();
    for root in workspace_roots {
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
    apply_browser_turn_items_view(
        &mut turns,
        params
            .items_view
            .unwrap_or(protocol::TurnItemsView::Summary),
    );
    if !matches!(params.sort_direction, Some(protocol::SortDirection::Asc)) {
        turns.reverse();
    }
    let turn_values = turns
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_js_error)?;
    let (turns, next_cursor, backwards_cursor) =
        paginate_values(&turn_values, params.cursor, params.limit);
    post_protocol_json_response(
        port,
        request_id,
        serde_json::json!({
            "data": turns,
            "nextCursor": next_cursor,
            "backwardsCursor": backwards_cursor,
        }),
    )
}

#[cfg(feature = "real-codex")]
fn apply_browser_turn_items_view(
    turns: &mut [protocol::Turn],
    items_view: protocol::TurnItemsView,
) {
    for turn in turns {
        match items_view {
            protocol::TurnItemsView::NotLoaded => {
                turn.items.clear();
                turn.items_view = protocol::TurnItemsView::NotLoaded;
            }
            protocol::TurnItemsView::Summary => {
                let first_user_message = turn
                    .items
                    .iter()
                    .find(|item| matches!(item, protocol::ThreadItem::UserMessage { .. }))
                    .cloned();
                let final_agent_message = turn
                    .items
                    .iter()
                    .rev()
                    .find(|item| matches!(item, protocol::ThreadItem::AgentMessage { .. }))
                    .cloned();
                turn.items = match (first_user_message, final_agent_message) {
                    (Some(user_message), Some(agent_message)) => {
                        vec![user_message, agent_message]
                    }
                    (Some(user_message), None) => vec![user_message],
                    (None, Some(agent_message)) => vec![agent_message],
                    (None, None) => Vec::new(),
                };
                turn.items_view = protocol::TurnItemsView::Summary;
            }
            protocol::TurnItemsView::Full => {
                turn.items_view = protocol::TurnItemsView::Full;
            }
        }
    }
}

#[cfg(feature = "real-codex")]
fn list_browser_thread_turn_items(
    port: &MessagePort,
    state: &Rc<RefCell<BrowserProtocolState>>,
    request_id: protocol::RequestId,
    params: protocol::ThreadItemsListParams,
) -> Result<(), JsValue> {
    let mut items = {
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
            .iter()
            .filter(|turn| {
                params
                    .turn_id
                    .as_ref()
                    .is_none_or(|turn_id| turn.id == *turn_id)
            })
            .flat_map(|turn| {
                turn.items.iter().map(move |item| {
                    serde_json::json!({
                        "turnId": turn.id,
                        "item": item,
                    })
                })
            })
            .collect::<Vec<_>>()
    };
    if matches!(params.sort_direction, Some(protocol::SortDirection::Desc)) {
        items.reverse();
    }
    let (items, next_cursor, backwards_cursor) =
        paginate_values(&items, params.cursor, params.limit);
    post_protocol_json_response(
        port,
        request_id,
        serde_json::json!({
            "data": items,
            "nextCursor": next_cursor,
            "backwardsCursor": backwards_cursor,
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
    let (thread, thread_manager) = {
        let state = state.borrow();
        let Some(thread) = state
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
        let Some(thread_manager) = state.thread_manager.as_ref().map(Arc::clone) else {
            return post_error_response(
                port,
                request_id_to_js_value(&request_id),
                -32000,
                "browser thread manager is not initialized",
            );
        };
        (thread, thread_manager)
    };

    let port = port.clone();
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(error) =
            start_core_turn_async(&port, thread_manager, thread, request_id.clone(), params).await
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
async fn start_core_turn_async(
    port: &MessagePort,
    thread_manager: Arc<ThreadManager>,
    thread: Arc<CodexThread>,
    request_id: protocol::RequestId,
    params: protocol::TurnStartParams,
) -> Result<(), JsValue> {
    let thread_settings =
        build_turn_thread_settings_overrides(&thread_manager, &thread, &params).await?;
    let thread_id = params.thread_id;
    let client_user_message_id = params.client_user_message_id;
    let input = params
        .input
        .into_iter()
        .map(protocol::UserInput::into_core)
        .collect::<Vec<_>>();
    let turn_has_input = !input.is_empty();
    let additional_context = map_additional_context(params.additional_context);

    let turn_id = thread
        .submit_user_input_with_client_user_message_id(
            Op::UserInput {
                items: input,
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
    thread_manager: &ThreadManager,
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

    let environment_selections = params
        .environments
        .clone()
        .map(turn_environment_params_to_core)
        .transpose()?;
    if let Some(environment_selections) = environment_selections.as_ref() {
        thread_manager
            .validate_environment_selections(environment_selections)
            .map_err(to_js_error)?;
    }
    let environments = build_turn_environment_override(
        thread_manager,
        thread,
        params.cwd.clone(),
        params.runtime_workspace_roots.clone(),
        environment_selections,
    )
    .await;
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
        environments: environments.clone(),
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
                environments,
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
async fn build_turn_environment_override(
    thread_manager: &ThreadManager,
    thread: &CodexThread,
    cwd: Option<PathBuf>,
    workspace_roots: Option<Vec<AbsolutePathBuf>>,
    environment_selections: Option<Vec<TurnEnvironmentSelection>>,
) -> Option<TurnEnvironmentSelections> {
    if cwd.is_none() && workspace_roots.is_none() && environment_selections.is_none() {
        return None;
    }

    let snapshot = thread.config_snapshot().await;
    let current_cwd = snapshot.cwd().clone();
    let cwd = cwd.map(|cwd| AbsolutePathBuf::resolve_path_against_base(cwd, current_cwd.as_path()));

    // Explicit environments own their runtime roots. The top-level
    // runtimeWorkspaceRoots input only configures the default environment.
    if let Some(environment_selections) = environment_selections {
        let legacy_fallback_cwd = cwd.unwrap_or_else(|| {
            environment_selections
                .iter()
                .find(|selection| selection.environment_id == LOCAL_ENVIRONMENT_ID)
                .and_then(|selection| {
                    AbsolutePathBuf::from_absolute_path_checked(selection.cwd.to_path_buf()).ok()
                })
                .unwrap_or(current_cwd)
        });
        return Some(TurnEnvironmentSelections::new(
            legacy_fallback_cwd,
            environment_selections,
        ));
    }

    let legacy_fallback_cwd = cwd.unwrap_or_else(|| current_cwd.clone());
    let workspace_roots = match workspace_roots {
        Some(workspace_roots) => resolve_runtime_workspace_roots(workspace_roots),
        None => {
            // Preserve additional roots while retargeting the old cwd root when
            // callers update only cwd.
            let mut retargeted_workspace_roots = Vec::new();
            for root in snapshot.workspace_roots {
                let root = if root == current_cwd {
                    legacy_fallback_cwd.clone()
                } else {
                    root
                };
                if !retargeted_workspace_roots.contains(&root) {
                    retargeted_workspace_roots.push(root);
                }
            }
            retargeted_workspace_roots
        }
    };
    let environment_selections =
        thread_manager.default_environment_selections(&legacy_fallback_cwd, &workspace_roots);
    Some(TurnEnvironmentSelections::new(
        legacy_fallback_cwd,
        environment_selections,
    ))
}

#[cfg(feature = "real-codex")]
fn thread_list_result(
    state: &Rc<RefCell<BrowserProtocolState>>,
    params: protocol::ThreadListParams,
) -> Result<serde_json::Value, JsValue> {
    let state = state.borrow();
    let mut ids = state
        .loaded_thread_ids
        .iter()
        .filter(|id| {
            let Some(thread) = state.threads.get(*id) else {
                return false;
            };
            thread_matches_list_params(&state, thread, &params)
        })
        .cloned()
        .collect::<Vec<_>>();
    sort_thread_ids(
        &state,
        &mut ids,
        params
            .sort_key
            .unwrap_or(protocol::ThreadSortKey::CreatedAt),
        params
            .sort_direction
            .unwrap_or(protocol::SortDirection::Desc),
    );
    let (ids, next_cursor, backwards_cursor) = paginate_ids(&ids, params.cursor, params.limit);
    let data = ids
        .into_iter()
        .filter_map(|id| state.threads.get(&id).map(|thread| thread.thread.clone()))
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "data": data,
        "nextCursor": next_cursor,
        "backwardsCursor": backwards_cursor,
    }))
}

#[cfg(feature = "real-codex")]
fn thread_search_result(
    state: &Rc<RefCell<BrowserProtocolState>>,
    params: protocol::ThreadSearchParams,
) -> Result<serde_json::Value, JsValue> {
    let state = state.borrow();
    let query = params.search_term.to_lowercase();
    let mut ids = state
        .loaded_thread_ids
        .iter()
        .filter(|id| {
            let Some(thread) = state.threads.get(*id) else {
                return false;
            };
            if params.archived.unwrap_or(false)
                || !thread_source_matches(thread, params.source_kinds.as_deref())
            {
                return false;
            }
            let haystack = format!(
                "{} {}",
                thread.thread["preview"].as_str().unwrap_or_default(),
                thread.thread["name"].as_str().unwrap_or_default()
            )
            .to_lowercase();
            query.is_empty() || haystack.contains(&query) || id.to_lowercase().contains(&query)
        })
        .cloned()
        .collect::<Vec<_>>();
    sort_thread_ids(
        &state,
        &mut ids,
        params
            .sort_key
            .unwrap_or(protocol::ThreadSortKey::CreatedAt),
        params
            .sort_direction
            .unwrap_or(protocol::SortDirection::Desc),
    );
    let (ids, next_cursor, backwards_cursor) = paginate_ids(&ids, params.cursor, params.limit);
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
        "backwardsCursor": backwards_cursor,
    }))
}

#[cfg(feature = "real-codex")]
fn thread_matches_list_params(
    state: &BrowserProtocolState,
    thread: &BrowserThread,
    params: &protocol::ThreadListParams,
) -> bool {
    if params.archived.unwrap_or(false) {
        return false;
    }
    if !params.model_providers.as_deref().is_none_or(|providers| {
        providers.is_empty()
            || providers
                .iter()
                .any(|provider| thread.thread["modelProvider"].as_str() == Some(provider.as_str()))
    }) {
        return false;
    }
    if !thread_source_matches(thread, params.source_kinds.as_deref()) {
        return false;
    }
    if !params.cwd.as_ref().is_none_or(|filter| match filter {
        protocol::ThreadListCwdFilter::One(cwd) => {
            thread.thread["cwd"].as_str() == Some(cwd.as_str())
        }
        protocol::ThreadListCwdFilter::Many(cwds) => cwds
            .iter()
            .any(|cwd| thread.thread["cwd"].as_str() == Some(cwd.as_str())),
    }) {
        return false;
    }
    if !params.search_term.as_ref().is_none_or(|query| {
        let query = query.to_lowercase();
        let haystack = format!(
            "{} {}",
            thread.thread["preview"].as_str().unwrap_or_default(),
            thread.thread["name"].as_str().unwrap_or_default()
        )
        .to_lowercase();
        query.is_empty() || haystack.contains(&query)
    }) {
        return false;
    }
    if !params.parent_thread_id.as_ref().is_none_or(|parent_id| {
        thread.thread["parentThreadId"].as_str() == Some(parent_id.as_str())
    }) {
        return false;
    }
    params
        .ancestor_thread_id
        .as_ref()
        .is_none_or(|ancestor_id| thread_has_ancestor(state, thread, ancestor_id))
}

#[cfg(feature = "real-codex")]
fn thread_has_ancestor(
    state: &BrowserProtocolState,
    thread: &BrowserThread,
    ancestor_id: &str,
) -> bool {
    let mut parent_id = thread.thread["parentThreadId"].as_str();
    let mut remaining = state.threads.len();
    while let Some(id) = parent_id {
        if id == ancestor_id {
            return true;
        }
        if remaining == 0 {
            return false;
        }
        remaining -= 1;
        parent_id = state
            .threads
            .get(id)
            .and_then(|parent| parent.thread["parentThreadId"].as_str());
    }
    false
}

#[cfg(feature = "real-codex")]
fn thread_source_matches(
    thread: &BrowserThread,
    source_kinds: Option<&[protocol::ThreadSourceKind]>,
) -> bool {
    let Some(source_kinds) = source_kinds else {
        return true;
    };
    if source_kinds.is_empty() {
        return true;
    }
    let source = thread.thread["source"].as_str().unwrap_or_default();
    source_kinds.iter().any(|kind| {
        serde_json::to_value(kind)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .as_deref()
            == Some(source)
    })
}

#[cfg(feature = "real-codex")]
fn sort_thread_ids(
    state: &BrowserProtocolState,
    ids: &mut [String],
    sort_key: protocol::ThreadSortKey,
    sort_direction: protocol::SortDirection,
) {
    let field = match sort_key {
        protocol::ThreadSortKey::CreatedAt => "createdAt",
        protocol::ThreadSortKey::UpdatedAt => "updatedAt",
        protocol::ThreadSortKey::RecencyAt => "recencyAt",
    };
    ids.sort_by(|left, right| {
        let timestamp = |id: &str| {
            state
                .threads
                .get(id)
                .and_then(|thread| thread.thread[field].as_i64())
                .unwrap_or_default()
        };
        timestamp(left)
            .cmp(&timestamp(right))
            .then_with(|| left.cmp(right))
    });
    if matches!(sort_direction, protocol::SortDirection::Desc) {
        ids.reverse();
    }
}

#[cfg(feature = "real-codex")]
fn thread_loaded_list_result(
    state: &Rc<RefCell<BrowserProtocolState>>,
    params: protocol::ThreadLoadedListParams,
) -> serde_json::Value {
    let state = state.borrow();
    let (data, next_cursor, _) =
        paginate_ids(&state.loaded_thread_ids, params.cursor, params.limit);
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
) -> (Vec<String>, Option<String>, Option<String>) {
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
    let backwards_cursor = (start < end).then(|| ids.len().saturating_sub(start + 1).to_string());
    (ids[start..end].to_vec(), next_cursor, backwards_cursor)
}

#[cfg(feature = "real-codex")]
fn paginate_values(
    values: &[serde_json::Value],
    cursor: Option<String>,
    limit: Option<u32>,
) -> (Vec<serde_json::Value>, Option<String>, Option<String>) {
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
    let backwards_cursor =
        (start < end).then(|| values.len().saturating_sub(start + 1).to_string());
    (values[start..end].to_vec(), next_cursor, backwards_cursor)
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
    let params = serialize_json_to_js(&params)?;
    set_value(&notification, "params", params);
    port.post_message(&notification)
}

#[cfg(feature = "real-codex")]
fn post_protocol_notification(
    port: &MessagePort,
    notification: protocol::ServerNotification,
) -> Result<(), JsValue> {
    let value = serialize_json_to_js(&notification)?;
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
            post_protocol_response(
                port,
                request_id,
                protocol::FsReadFileResponse {
                    data_base64: result.content,
                },
            )
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
            post_protocol_response(
                port,
                request_id,
                protocol::FsReadDirectoryResponse { entries },
            )
        }
        PendingHostRequest::FsGetMetadata { request_id } => {
            let result: HostMetadataResult =
                serde_wasm_bindgen::from_value(result).map_err(to_js_error)?;
            post_protocol_response(
                port,
                request_id,
                protocol::FsGetMetadataResponse {
                    is_directory: result.entry_type == "directory",
                    is_file: result.entry_type == "file",
                    is_symlink: false,
                    created_at_ms: 0,
                    modified_at_ms: result.mtime_ms.round() as i64,
                },
            )
        }
        PendingHostRequest::CommandExec {
            request_id,
            streamed,
        } => {
            let result: HostCommandExecResult =
                serde_wasm_bindgen::from_value(result).map_err(to_js_error)?;
            post_protocol_response(
                port,
                request_id,
                protocol::CommandExecResponse {
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
                },
            )
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
        "userAgent": format!("almostnode-codex-wasm/{CODEX_CLI_VERSION}"),
        "codexHome": BROWSER_CODEX_HOME,
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
    serialize_json_to_js(&protocol::JSONRPCResponse { id, result })
}

#[cfg(feature = "real-codex")]
fn serialize_json_to_js(value: &impl Serialize) -> Result<JsValue, JsValue> {
    let json = serde_json::to_string(value).map_err(to_js_error)?;
    js_sys::JSON::parse(&json)
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
