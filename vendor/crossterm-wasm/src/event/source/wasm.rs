use std::{io, time::Duration};

#[cfg(feature = "event-stream")]
use crate::event::sys::Waker;
use super::{EventSource, InternalEvent};

#[derive(Default)]
pub(crate) struct WasmEventSource;

impl WasmEventSource {
    pub(crate) fn new() -> io::Result<Self> {
        Ok(Self)
    }
}

impl EventSource for WasmEventSource {
    fn try_read(&mut self, _timeout: Option<Duration>) -> io::Result<Option<InternalEvent>> {
        Ok(None)
    }

    #[cfg(feature = "event-stream")]
    fn waker(&self) -> Waker {
        Waker
    }
}
