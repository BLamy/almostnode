use std::io;

use crate::event::KeyboardEnhancementFlags;
use crate::terminal::WindowSize;

pub(crate) fn is_raw_mode_enabled() -> bool {
    false
}

pub(crate) fn enable_raw_mode() -> io::Result<()> {
    Ok(())
}

pub(crate) fn disable_raw_mode() -> io::Result<()> {
    Ok(())
}

pub(crate) fn size() -> io::Result<(u16, u16)> {
    Ok((80, 24))
}

pub(crate) fn window_size() -> io::Result<WindowSize> {
    Ok(WindowSize {
        columns: 80,
        rows: 24,
        width: 0,
        height: 0,
    })
}

#[cfg(feature = "events")]
pub fn supports_keyboard_enhancement() -> io::Result<Option<KeyboardEnhancementFlags>> {
    Ok(None)
}
