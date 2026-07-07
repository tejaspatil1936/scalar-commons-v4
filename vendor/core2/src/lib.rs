//! Minimal shim replacing the yanked core2 0.4.0 from crates.io.
//! Provides the io traits used by cid v0.9.0 in no_std environments.
#![no_std]

pub mod io {
    /// Represents an I/O error (minimal surface for no_std).
    #[derive(Debug)]
    pub struct Error {
        kind: ErrorKind,
    }

    #[derive(Copy, Clone, Debug, PartialEq, Eq)]
    pub enum ErrorKind {
        UnexpectedEof,
        WriteZero,
        Other,
    }

    impl Error {
        pub fn new<E>(_kind: ErrorKind, _err: E) -> Error {
            Error { kind: _kind }
        }

        pub fn kind(&self) -> ErrorKind {
            self.kind
        }
    }

    pub type Result<T> = core::result::Result<T, Error>;

    pub trait Read {
        fn read(&mut self, buf: &mut [u8]) -> Result<usize>;

        fn read_exact(&mut self, mut buf: &mut [u8]) -> Result<()> {
            while !buf.is_empty() {
                match self.read(buf) {
                    Ok(0) => {
                        return Err(Error {
                            kind: ErrorKind::UnexpectedEof,
                        })
                    }
                    Ok(n) => {
                        let tmp = buf;
                        buf = &mut tmp[n..];
                    }
                    Err(e) => return Err(e),
                }
            }
            Ok(())
        }
    }

    pub trait Write {
        fn write(&mut self, buf: &[u8]) -> Result<usize>;
        fn flush(&mut self) -> Result<()>;

        fn write_all(&mut self, mut buf: &[u8]) -> Result<()> {
            while !buf.is_empty() {
                match self.write(buf) {
                    Ok(0) => {
                        return Err(Error {
                            kind: ErrorKind::WriteZero,
                        })
                    }
                    Ok(n) => buf = &buf[n..],
                    Err(e) => return Err(e),
                }
            }
            Ok(())
        }
    }

    pub trait BufRead: Read {
        fn fill_buf(&mut self) -> Result<&[u8]>;
        fn consume(&mut self, amt: usize);
    }
}
