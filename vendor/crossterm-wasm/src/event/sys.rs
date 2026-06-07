#[cfg(all(unix, feature = "event-stream"))]
pub(crate) use unix::waker::Waker;
#[cfg(all(target_arch = "wasm32", feature = "event-stream"))]
pub(crate) use wasm::Waker;
#[cfg(all(windows, feature = "event-stream"))]
pub(crate) use windows::waker::Waker;

#[cfg(unix)]
pub(crate) mod unix;
#[cfg(target_arch = "wasm32")]
pub(crate) mod wasm;
#[cfg(windows)]
pub(crate) mod windows;
