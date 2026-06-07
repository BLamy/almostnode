#[cfg(feature = "event-stream")]
#[derive(Clone, Debug, Default)]
pub(crate) struct Waker;

#[cfg(feature = "event-stream")]
impl Waker {
    pub(crate) fn wake(&self) -> std::io::Result<()> {
        Ok(())
    }

    #[allow(dead_code, clippy::unnecessary_wraps)]
    pub(crate) fn reset(&self) -> std::io::Result<()> {
        Ok(())
    }
}
