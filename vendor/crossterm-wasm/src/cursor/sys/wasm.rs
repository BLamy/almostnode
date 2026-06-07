use std::io;

/// Browser builds do not own an OS terminal cursor. The embedding terminal
/// surface is responsible for cursor placement.
pub fn position() -> io::Result<(u16, u16)> {
    Ok((0, 0))
}
