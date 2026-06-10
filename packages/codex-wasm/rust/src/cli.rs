use codex_cli::BrowserCodexCliSession;
use codex_cli::BrowserExecPlan;
use codex_cli::BrowserLoginMethod;
use codex_cli::BrowserLoginRequest;
use codex_cli::BrowserRunOptions;
use codex_cli::BrowserRunResult;
use codex_cli::BrowserTuiAction;
use codex_cli::BrowserTuiRunResult;
use js_sys::Array;
use js_sys::Object;
use js_sys::Reflect;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CodexCliWasm {
    state: RefCell<BrowserCliState>,
}

#[derive(Debug)]
struct BrowserCliState {
    upstream: BrowserCodexCliSession,
}

impl Default for BrowserCliState {
    fn default() -> Self {
        Self {
            upstream: BrowserCodexCliSession::new(),
        }
    }
}

#[derive(Debug)]
struct RunResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    env: Vec<(String, String)>,
    browser_exec: Option<BrowserExecPlan>,
    browser_login: Option<BrowserLoginRequest>,
    browser_tui: Option<BrowserTuiRunResult>,
}

#[derive(Debug)]
struct RunOptions {
    cwd: Option<String>,
    stdin: Option<String>,
    env: Vec<(String, String)>,
    terminal_width: Option<u16>,
    terminal_height: Option<u16>,
}

impl From<BrowserRunResult> for RunResult {
    fn from(result: BrowserRunResult) -> Self {
        RunResult {
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exit_code,
            env: result.env,
            browser_exec: result.browser_exec,
            browser_login: result.browser_login,
            browser_tui: result.browser_tui,
        }
    }
}

#[wasm_bindgen]
impl CodexCliWasm {
    #[wasm_bindgen(constructor)]
    pub fn new() -> CodexCliWasm {
        console_error_panic_hook::set_once();
        CodexCliWasm {
            state: RefCell::new(BrowserCliState::default()),
        }
    }

    #[wasm_bindgen]
    pub fn start(&self, _port: JsValue) -> Result<(), JsValue> {
        Ok(())
    }

    #[wasm_bindgen]
    pub fn run(&self, args: JsValue, options: JsValue) -> Result<JsValue, JsValue> {
        let args = read_args(args)?;
        let options = read_options(options);
        let result = self.run_argv(args, options);
        result_to_js(result)
    }

    #[wasm_bindgen]
    pub fn dispose(&self) {}
}

impl CodexCliWasm {
    fn run_argv(&self, args: Vec<String>, options: RunOptions) -> RunResult {
        let mut state = self.state.borrow_mut();
        state
            .upstream
            .run(
                args,
                BrowserRunOptions {
                    cwd: options.cwd,
                    stdin: options.stdin,
                    env: options.env,
                    terminal_width: options.terminal_width,
                    terminal_height: options.terminal_height,
                },
            )
            .into()
    }
}

fn read_args(args: JsValue) -> Result<Vec<String>, JsValue> {
    if !Array::is_array(&args) {
        return Err(JsValue::from_str(
            "Codex CLI run(args, options) expected args to be an array.",
        ));
    }

    let args = Array::from(&args);
    let mut out = Vec::with_capacity(args.length() as usize);
    for arg in args.iter() {
        let Some(arg) = arg.as_string() else {
            return Err(JsValue::from_str(
                "Codex CLI args must contain only strings.",
            ));
        };
        out.push(arg);
    }
    Ok(out)
}

fn read_options(options: JsValue) -> RunOptions {
    RunOptions {
        cwd: read_string_property(&options, "cwd"),
        stdin: read_string_property(&options, "stdin"),
        env: read_env(&options),
        terminal_width: read_terminal_dimension(&options, "columns"),
        terminal_height: read_terminal_dimension(&options, "rows"),
    }
}

fn read_string_property(value: &JsValue, key: &str) -> Option<String> {
    Reflect::get(value, &JsValue::from_str(key))
        .ok()
        .and_then(|value| value.as_string())
}

fn read_env(options: &JsValue) -> Vec<(String, String)> {
    let Ok(env) = Reflect::get(options, &JsValue::from_str("env")) else {
        return Vec::new();
    };
    if !env.is_object() || env.is_null() || env.is_undefined() {
        return Vec::new();
    }

    let keys = Object::keys(&Object::from(env.clone()));
    let mut out = Vec::with_capacity(keys.length() as usize);
    for key in keys.iter() {
        let Some(key) = key.as_string() else {
            continue;
        };
        let value = Reflect::get(&env, &JsValue::from_str(&key))
            .ok()
            .and_then(|value| value.as_string());
        if let Some(value) = value {
            out.push((key, value));
        }
    }
    out
}

fn read_terminal_dimension(options: &JsValue, key: &str) -> Option<u16> {
    let terminal_size = Reflect::get(options, &JsValue::from_str("terminalSize")).ok()?;
    if !terminal_size.is_object() || terminal_size.is_null() || terminal_size.is_undefined() {
        return None;
    }

    Reflect::get(&terminal_size, &JsValue::from_str(key))
        .ok()
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite() && *value > 0.0 && *value <= u16::MAX as f64)
        .map(|value| value as u16)
}

fn result_to_js(result: RunResult) -> Result<JsValue, JsValue> {
    let value = Object::new();
    Reflect::set(
        &value,
        &JsValue::from_str("stdout"),
        &JsValue::from_str(&result.stdout),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("stderr"),
        &JsValue::from_str(&result.stderr),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("exitCode"),
        &JsValue::from_f64(result.exit_code as f64),
    )?;
    if !result.env.is_empty() {
        let env = Object::new();
        for (name, value) in result.env {
            Reflect::set(&env, &JsValue::from_str(&name), &JsValue::from_str(&value))?;
        }
        Reflect::set(&value, &JsValue::from_str("env"), &env)?;
    }
    if let Some(plan) = result.browser_exec {
        Reflect::set(
            &value,
            &JsValue::from_str("browserExec"),
            &browser_exec_to_js(plan)?,
        )?;
    }
    if let Some(login) = result.browser_login {
        Reflect::set(
            &value,
            &JsValue::from_str("browserLogin"),
            &browser_login_to_js(login)?,
        )?;
    }
    if let Some(tui) = result.browser_tui {
        Reflect::set(
            &value,
            &JsValue::from_str("browserTui"),
            &browser_tui_to_js(tui)?,
        )?;
    }
    Ok(value.into())
}

fn browser_exec_to_js(plan: BrowserExecPlan) -> Result<JsValue, JsValue> {
    let value = Object::new();
    Reflect::set(
        &value,
        &JsValue::from_str("prompt"),
        &JsValue::from_str(&plan.prompt),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("model"),
        &JsValue::from_str(&plan.model),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("instructions"),
        &JsValue::from_str(&plan.instructions),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("toolChoice"),
        &JsValue::from_str(&plan.tool_choice),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("parallelToolCalls"),
        &JsValue::from_bool(plan.parallel_tool_calls),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("store"),
        &JsValue::from_bool(plan.store),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("stream"),
        &JsValue::from_bool(plan.stream),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("json"),
        &JsValue::from_bool(plan.json),
    )?;
    if let Some(path) = plan.output_last_message_path {
        Reflect::set(
            &value,
            &JsValue::from_str("outputLastMessagePath"),
            &JsValue::from_str(&path),
        )?;
    }
    if let Some(grammar) = plan.apply_patch_grammar {
        Reflect::set(
            &value,
            &JsValue::from_str("applyPatchGrammar"),
            &JsValue::from_str(&grammar),
        )?;
    }
    if let Some(cwd) = plan.cwd {
        Reflect::set(&value, &JsValue::from_str("cwd"), &JsValue::from_str(&cwd))?;
    }

    let warnings = Array::new();
    for warning in plan.warnings {
        warnings.push(&JsValue::from_str(&warning));
    }
    Reflect::set(&value, &JsValue::from_str("warnings"), &warnings)?;
    Ok(value.into())
}

fn browser_login_to_js(request: BrowserLoginRequest) -> Result<JsValue, JsValue> {
    let value = Object::new();
    match request.method {
        BrowserLoginMethod::ChatGpt => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("chatgpt"),
            )?;
        }
        BrowserLoginMethod::DeviceCode => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("deviceCode"),
            )?;
        }
    }
    Ok(value.into())
}

fn browser_tui_to_js(result: BrowserTuiRunResult) -> Result<JsValue, JsValue> {
    let value = Object::new();
    Reflect::set(
        &value,
        &JsValue::from_str("ansi"),
        &JsValue::from_str(&result.ansi),
    )?;
    Reflect::set(
        &value,
        &JsValue::from_str("action"),
        &browser_tui_action_to_js(result.action)?,
    )?;
    if let Some(cursor) = result.cursor {
        let cursor_value = Object::new();
        Reflect::set(
            &cursor_value,
            &JsValue::from_str("x"),
            &JsValue::from_f64(cursor.x as f64),
        )?;
        Reflect::set(
            &cursor_value,
            &JsValue::from_str("y"),
            &JsValue::from_f64(cursor.y as f64),
        )?;
        Reflect::set(&value, &JsValue::from_str("cursor"), &cursor_value)?;
    }
    if let Some(scrollback_ansi) = result.scrollback_ansi {
        if !scrollback_ansi.is_empty() {
            Reflect::set(
                &value,
                &JsValue::from_str("scrollbackAnsi"),
                &JsValue::from_str(&scrollback_ansi),
            )?;
        }
    }
    Ok(value.into())
}

fn browser_tui_action_to_js(action: BrowserTuiAction) -> Result<JsValue, JsValue> {
    let value = Object::new();
    match action {
        BrowserTuiAction::None => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("none"),
            )?;
        }
        BrowserTuiAction::Login => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("login"),
            )?;
        }
        BrowserTuiAction::Exec { prompt } => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("exec"),
            )?;
            Reflect::set(
                &value,
                &JsValue::from_str("prompt"),
                &JsValue::from_str(&prompt),
            )?;
        }
        BrowserTuiAction::Shell { command } => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("shell"),
            )?;
            Reflect::set(
                &value,
                &JsValue::from_str("command"),
                &JsValue::from_str(&command),
            )?;
        }
        BrowserTuiAction::Exit { exit_code } => {
            Reflect::set(
                &value,
                &JsValue::from_str("type"),
                &JsValue::from_str("exit"),
            )?;
            Reflect::set(
                &value,
                &JsValue::from_str("exitCode"),
                &JsValue::from_f64(exit_code as f64),
            )?;
        }
    }
    Ok(value.into())
}

#[wasm_bindgen(js_name = createCodexCliWasm)]
pub fn create_codex_cli_wasm() -> CodexCliWasm {
    CodexCliWasm::new()
}
