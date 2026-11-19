//! Which files in the open folder git sees as changed, so the explorer can mark
//! them. Read only: Scrivon never stages, commits or changes a repository.
//!
//! The user's own `git.exe` is run, quietly and safely:
//! - Never on the main thread (`spawn_blocking`), and only in a folder the
//!   file scope allows, as `workspace_image` checks.
//! - No console window (CREATE_NO_WINDOW, as `updater.rs` runs tasklist), no
//!   prompts (GIT_TERMINAL_PROMPT=0), and no `.git/index.lock`
//!   (`--no-optional-locks`), so it never gets in the way of the user's own git.
//! - Killed after 10 seconds, and stopped after 16 MB of output. Either, like
//!   git missing, a folder outside a repository, a repository git refuses
//!   ("dubious ownership") or git too old for porcelain v2, means no marks:
//!   one line in the log, never a notice.
//! - The system config isn't dropped (no GIT_CONFIG_NOSYSTEM): on Git for
//!   Windows it turns on `core.autocrlf`, `core.fscache` and the LFS filters,
//!   and without it clean files can look modified. `safe.directory` isn't
//!   overridden either, so git still refuses a repository another user owns.
//!
//! Threat model. A repository's own config can make `git status` run a
//! program. That matters for a folder copied, unzipped or shared together with
//! its `.git` folder (a clone doesn't carry `.git/config`), which the user only
//! means to read. Two ways in are closed here:
//! - `core.fsmonitor` names a program status starts: `-c core.fsmonitor=false`.
//! - A filter driver (`filter.<name>.clean` or `filter.<name>.process`, picked
//!   by `.gitattributes`) runs when status reads a file again whose details
//!   changed. So before status, `git config --show-scope --get-regexp` (which
//!   runs nothing) lists them, and a folder whose local or worktree config sets
//!   any (`lfs` too: a repository can point that name at anything) is skipped.
//!   Filters from the user's own global or system config, such as Git for
//!   Windows' LFS setup, are the user's choice and fine.
//!
//! `--ignore-submodules=dirty` keeps git out of submodules, whose config this
//! check doesn't read. Hooks don't run for status. Rust's `Command` doesn't
//! look for `git.exe` in the folder it runs in, so a `git.exe` planted in the
//! open folder is never the one run.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri_plugin_fs::FsExt;

/// How long all of git's work for one status may take.
pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(10);
/// The most output read from one git command.
pub(crate) const MAX_GIT_OUTPUT: usize = 16 * 1024 * 1024;
/// The most of git's error output kept, for the log.
const MAX_GIT_ERRORS: usize = 64 * 1024;
/// How often a running git is checked on.
const POLL_INTERVAL: Duration = Duration::from_millis(10);

const OUTSIDE_FOLDER: &str = "Git changes are only read for a folder you opened.";

/// What the explorer gets: the changes, nothing to show, or git took too long
/// (so the page waits for the next window focus before trying again).
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum GitStatusReply {
    Changes { entries: Vec<GitEntry> },
    None,
    TimedOut,
}

/// The kind of line in `git status --porcelain=v2`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    /// `1`: modified, added, deleted or a type change.
    Changed,
    /// `2`: renamed or copied (`from` is where it came from).
    Renamed,
    /// `u`: a merge conflict.
    Unmerged,
    /// `?`: not tracked yet.
    Untracked,
}

/// One changed path, relative to the open folder with `/` between names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
    pub kind: EntryKind,
    /// The index and work tree status letters, as git writes them (`.M`, `R.`,
    /// `UU`); `??` for an untracked path.
    pub xy: String,
    /// Empty for the open folder itself (all of it untracked).
    pub path: String,
    /// A folder git didn't list the inside of: all of it is untracked.
    pub dir: bool,
    /// Where a renamed or copied file came from, if that is in the open folder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

/// Why there are no marks.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GitFailure {
    NotInstalled,
    TimedOut,
    TooMuchOutput,
    /// The repository's own config sets these filter drivers.
    RepositoryFilters(Vec<String>),
    /// Git failed: not a repository, refused it, too old, or anything else.
    Failed(String),
}

impl std::fmt::Display for GitFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInstalled => write!(f, "git isn't installed"),
            Self::TimedOut => write!(f, "git took over {} seconds", GIT_TIMEOUT.as_secs()),
            Self::TooMuchOutput => write!(f, "git wrote over {} MB", MAX_GIT_OUTPUT / (1024 * 1024)),
            Self::RepositoryFilters(keys) => write!(
                f,
                "the repository's own config sets filters that git would run ({}), so git isn't run there",
                keys.join(", ")
            ),
            Self::Failed(why) => write!(f, "{why}"),
        }
    }
}

/// The changes in `folder`, an open folder. A folder the file scope doesn't
/// allow is refused; anything else that goes wrong is no marks.
#[tauri::command]
pub async fn git_status(app: tauri::AppHandle, folder: String) -> Result<GitStatusReply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.fs_scope();
        let folder = allowed_folder(Path::new(&folder), |path| scope.is_allowed(path))?;
        Ok(reply(&folder, status_of(&Git::installed(), &folder)))
    })
    .await
    .map_err(|err| err.to_string())?
}

/// What the page is told, with one line in the log when there are no marks.
fn reply(folder: &Path, status: Result<Vec<GitEntry>, GitFailure>) -> GitStatusReply {
    match status {
        Ok(entries) => {
            forget_failure(folder);
            GitStatusReply::Changes { entries }
        }
        Err(failure) => {
            log_failure_once(folder, &failure);
            if failure == GitFailure::TimedOut {
                GitStatusReply::TimedOut
            } else {
                GitStatusReply::None
            }
        }
    }
}

/// The last reason logged for each folder, so a folder outside a repository
/// logs it once, not after every save and focus.
fn logged_failures() -> &'static Mutex<HashMap<PathBuf, String>> {
    static LOGGED: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();
    LOGGED.get_or_init(Default::default)
}

fn log_failure_once(folder: &Path, failure: &GitFailure) {
    let why = failure.to_string();
    let mut logged = logged_failures()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if logged.get(folder) == Some(&why) {
        return;
    }
    // Only a few folders are opened in a session; this keeps it small anyway.
    if logged.len() >= 64 {
        logged.clear();
    }
    // The folder's name stays out of the log, which is attached to bug reports.
    log::info!("No git changes shown for the open folder: {why}");
    logged.insert(folder.to_path_buf(), why);
}

fn forget_failure(folder: &Path) {
    logged_failures()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(folder);
}

/// `folder` as written, when it is a folder the file scope allows (where it
/// really is on disk, so a link or junction can't lead elsewhere). Git runs in
/// it as written: Windows' canonical `\\?\` form confuses it.
fn allowed_folder(folder: &Path, in_scope: impl Fn(&Path) -> bool) -> Result<PathBuf, String> {
    if !folder.is_absolute() || folder.components().any(|part| part == Component::ParentDir) {
        return Err(OUTSIDE_FOLDER.into());
    }
    let real = std::fs::canonicalize(folder).map_err(|_| OUTSIDE_FOLDER.to_string())?;
    if !real.is_dir() || !in_scope(&real) {
        return Err(OUTSIDE_FOLDER.into());
    }
    Ok(folder.to_path_buf())
}

/// The changes git sees in `folder` (and the folders in it).
pub(crate) fn status_of(git: &Git, folder: &Path) -> Result<Vec<GitEntry>, GitFailure> {
    let deadline = Instant::now() + GIT_TIMEOUT;

    // Where the folder is in its repository ("" at the top, "docs/" below it).
    // It also fails outside a repository and in one git refuses.
    let prefix = git.run(
        git.command(folder, &["rev-parse", "--show-prefix"]),
        deadline,
    )?;
    let prefix = String::from_utf8_lossy(&prefix.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string();

    let filters = git.run(git.command(folder, &FILTER_CHECK), deadline)?;
    let keys = repository_filters(&filters.stdout);
    if !keys.is_empty() {
        return Err(GitFailure::RepositoryFilters(keys));
    }

    let status = git.run(git.command(folder, &STATUS), deadline)?;
    Ok(parse_porcelain_v2(&status.stdout, &prefix))
}

/// Lists the filter drivers that status could run, with where each is set.
const FILTER_CHECK: [&str; 5] = [
    "config",
    "--show-scope",
    "-z",
    "--get-regexp",
    r"^filter\..*\.(clean|process)$",
];

/// Only the open folder (`.` is where git runs), and nothing inside submodules.
const STATUS: [&str; 7] = [
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=normal",
    "--ignore-submodules=dirty",
    "--",
    ".",
];

/// The config keys in `output` (`git config --show-scope -z --get-regexp`:
/// scope NUL, then key, newline, value NUL) that aren't from the user's own
/// global or system config, or from the command line.
fn repository_filters(output: &[u8]) -> Vec<String> {
    let mut records = output.split(|byte| *byte == 0);
    let mut keys = Vec::new();
    while let (Some(scope), Some(entry)) = (records.next(), records.next()) {
        let scope = String::from_utf8_lossy(scope);
        if matches!(scope.as_ref(), "global" | "system" | "command") {
            continue;
        }
        let key = entry
            .split(|byte| *byte == b'\n')
            .next()
            .unwrap_or_default();
        keys.push(String::from_utf8_lossy(key).into_owned());
    }
    keys
}

/// Reads `git status --porcelain=v2 -z`. Its paths are from the top of the
/// repository; `prefix` (from `rev-parse --show-prefix`) is the open folder's
/// place there, and is taken off them. Anything else is left out.
fn parse_porcelain_v2(output: &[u8], prefix: &str) -> Vec<GitEntry> {
    let mut records = output
        .split(|byte| *byte == 0)
        .map(|record| String::from_utf8_lossy(record).into_owned());
    let mut entries = Vec::new();
    while let Some(record) = records.next() {
        let (kind, fields) = match record.as_bytes().first() {
            Some(b'1') => (EntryKind::Changed, 9),
            Some(b'2') => (EntryKind::Renamed, 10),
            Some(b'u') => (EntryKind::Unmerged, 11),
            Some(b'?') => (EntryKind::Untracked, 2),
            // Ignored files, headers, or a line this reader doesn't know.
            _ => continue,
        };
        // The path is last, and can hold spaces.
        let parts: Vec<&str> = record.splitn(fields, ' ').collect();
        // A rename's or copy's old path is the record after it.
        let from = if kind == EntryKind::Renamed {
            records.next()
        } else {
            None
        };
        if parts.len() != fields {
            continue;
        }
        let xy = if kind == EntryKind::Untracked {
            "??".to_string()
        } else {
            parts[1].to_string()
        };
        let raw = parts[fields - 1];
        let dir = kind == EntryKind::Untracked && raw.ends_with('/');
        let Some(path) = inside_prefix(raw.trim_end_matches('/'), prefix) else {
            continue;
        };
        let from = from.and_then(|from| inside_prefix(&from, prefix));
        entries.push(GitEntry {
            kind,
            xy,
            path,
            dir,
            from,
        });
    }
    entries
}

/// `path` (from the top of the repository) from the open folder, or None when
/// it is outside it. Letter case is ignored on Windows, where names ignore it.
/// The open folder itself, all of it untracked, comes back as "".
fn inside_prefix(path: &str, prefix: &str) -> Option<String> {
    if prefix.is_empty() {
        return Some(path.to_string());
    }
    let folder = prefix.trim_end_matches('/');
    let same = |a: &str, b: &str| {
        if cfg!(windows) {
            a.to_lowercase() == b.to_lowercase()
        } else {
            a == b
        }
    };
    if path.len() == folder.len() && path.is_char_boundary(folder.len()) && same(path, folder) {
        return Some(String::new());
    }
    if path.len() <= prefix.len() || !path.is_char_boundary(prefix.len()) {
        return None;
    }
    let (head, rest) = path.split_at(prefix.len());
    same(head, prefix).then(|| rest.to_string())
}

/// What a git command wrote.
pub(crate) struct GitOutput {
    pub stdout: Vec<u8>,
}

/// The git that is run: the user's own, found on the PATH.
pub(crate) struct Git {
    program: OsString,
}

impl Git {
    pub(crate) fn installed() -> Self {
        Self {
            program: "git".into(),
        }
    }

    #[cfg(test)]
    fn at(program: impl Into<OsString>) -> Self {
        Self {
            program: program.into(),
        }
    }

    /// `git <args>` in `dir`, made safe to run in any folder (see the top of
    /// this file). Every git command Scrivon runs is made here.
    pub(crate) fn command(&self, dir: &Path, args: &[&str]) -> Command {
        let mut command = Command::new(&self.program);
        command
            .current_dir(dir)
            .args(["--no-optional-locks", "-c", "core.fsmonitor=false"])
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            // Inherited ones would point git at another repository.
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
    }

    /// Runs `command`, which must succeed by `deadline` and write at most
    /// MAX_GIT_OUTPUT. `git config --get-regexp` finding nothing (exit 1 with
    /// no output) counts as success.
    pub(crate) fn run(&self, command: Command, deadline: Instant) -> Result<GitOutput, GitFailure> {
        run_capped(command, deadline, MAX_GIT_OUTPUT)
    }
}

/// Runs `command`, killing it at `deadline` or once it has written more than
/// `max_output` bytes.
fn run_capped(
    mut command: Command,
    deadline: Instant,
    max_output: usize,
) -> Result<GitOutput, GitFailure> {
    let mut child = command.spawn().map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => GitFailure::NotInstalled,
        _ => GitFailure::Failed(format!("git couldn't start: {err}")),
    })?;
    let too_much = Arc::new(AtomicBool::new(false));
    let stdout = read_in_background(child.stdout.take(), max_output, Some(too_much.clone()));
    let stderr = read_in_background(child.stderr.take(), MAX_GIT_ERRORS, None);

    let status = loop {
        if too_much.load(Ordering::Relaxed) {
            stop(&mut child);
            return Err(GitFailure::TooMuchOutput);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(err) => {
                stop(&mut child);
                return Err(GitFailure::Failed(err.to_string()));
            }
        }
        if Instant::now() >= deadline {
            stop(&mut child);
            return Err(GitFailure::TimedOut);
        }
        std::thread::sleep(POLL_INTERVAL);
    };
    // A program git started may still hold the pipes open, so the wait for
    // the rest of the output has the same deadline.
    let wait = deadline.saturating_duration_since(Instant::now());
    let stdout = match stdout.recv_timeout(wait) {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(())) => return Err(GitFailure::TooMuchOutput),
        Err(_) => return Err(GitFailure::TimedOut),
    };
    let stderr = stderr
        .recv_timeout(Duration::from_millis(100))
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    // `git config --get-regexp` with nothing to list.
    let nothing_found = status.code() == Some(1) && stdout.is_empty();
    if !status.success() && !nothing_found {
        let why = String::from_utf8_lossy(&stderr);
        let why = why
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .trim();
        return Err(GitFailure::Failed(if why.is_empty() {
            format!("git failed ({status})")
        } else {
            format!("git failed: {why}")
        }));
    }
    Ok(GitOutput { stdout })
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Reads `pipe` on its own thread. Past `max` bytes it stops, sets
/// `too_much` and sends `Err`; without `too_much` it keeps the first `max`
/// bytes and reads on, so the program never waits on a full pipe.
fn read_in_background(
    pipe: Option<impl Read + Send + 'static>,
    max: usize,
    too_much: Option<Arc<AtomicBool>>,
) -> mpsc::Receiver<Result<Vec<u8>, ()>> {
    let (send, receive) = mpsc::channel();
    let Some(mut pipe) = pipe else {
        let _ = send.send(Ok(Vec::new()));
        return receive;
    };
    std::thread::spawn(move || {
        let read = match &too_much {
            Some(flag) => {
                let read = read_capped(&mut pipe, max);
                if read.is_err() {
                    flag.store(true, Ordering::Relaxed);
                }
                read
            }
            None => {
                let mut kept = Vec::new();
                let _ = (&mut pipe).take(max as u64).read_to_end(&mut kept);
                let _ = io::copy(&mut pipe, &mut io::sink());
                Ok(kept)
            }
        };
        let _ = send.send(read);
    });
    receive
}

/// Everything in `reader`, or `Err` once it is over `max` bytes. A read that
/// fails ends it, as the pipe closing does.
fn read_capped(reader: impl Read, max: usize) -> Result<Vec<u8>, ()> {
    let mut bytes = Vec::new();
    // One byte over is enough to tell.
    let _ = reader.take(max as u64 + 1).read_to_end(&mut bytes);
    if bytes.len() > max {
        Err(())
    } else {
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "scrivon-git-status-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn write(&self, name: &str, text: &str) {
            let path = self.0.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn entry(kind: EntryKind, xy: &str, path: &str) -> GitEntry {
        GitEntry {
            kind,
            xy: xy.into(),
            path: path.into(),
            dir: false,
            from: None,
        }
    }

    const HASHES: &str = "100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85";

    #[test]
    fn reads_each_kind_of_change_with_spaces_and_non_english_names() {
        let output = [
            format!("1 .M N... {HASHES} sub dir/ü/a b.md"),
            format!("1 A. N... {HASHES} new.md"),
            format!("2 R. N... {HASHES} R100 notes/kept.md"),
            "notes/keep.md".to_string(),
            "u UU N... 100644 100644 100644 100644 a1 b2 c3 中文 名.md".to_string(),
            "? fresh/".to_string(),
            "? loose file.md".to_string(),
            "! ignored.log".to_string(),
            String::new(),
        ]
        .join("\0");

        let entries = parse_porcelain_v2(output.as_bytes(), "");

        assert_eq!(
            entries,
            vec![
                entry(EntryKind::Changed, ".M", "sub dir/ü/a b.md"),
                entry(EntryKind::Changed, "A.", "new.md"),
                GitEntry {
                    from: Some("notes/keep.md".into()),
                    ..entry(EntryKind::Renamed, "R.", "notes/kept.md")
                },
                entry(EntryKind::Unmerged, "UU", "中文 名.md"),
                GitEntry {
                    dir: true,
                    ..entry(EntryKind::Untracked, "??", "fresh")
                },
                entry(EntryKind::Untracked, "??", "loose file.md"),
            ]
        );
    }

    #[test]
    fn gives_paths_from_the_open_folder_when_it_is_inside_the_repository() {
        let output = [
            format!("1 .M N... {HASHES} docs/a.md"),
            format!("1 .M N... {HASHES} elsewhere/b.md"),
            format!("2 R. N... {HASHES} R100 docs/new.md"),
            "old.md".to_string(),
            "? docs/".to_string(),
        ]
        .join("\0");

        let entries = parse_porcelain_v2(output.as_bytes(), "docs/");

        assert_eq!(
            entries,
            vec![
                entry(EntryKind::Changed, ".M", "a.md"),
                // It came from outside the open folder.
                entry(EntryKind::Renamed, "R.", "new.md"),
                GitEntry {
                    dir: true,
                    ..entry(EntryKind::Untracked, "??", "")
                },
            ]
        );
        assert_eq!(inside_prefix("docsx/a.md", "docs/"), None);
        assert_eq!(inside_prefix("doc", "docs/"), None);
        if cfg!(windows) {
            assert_eq!(inside_prefix("Docs/A.md", "docs/"), Some("A.md".into()));
        }
    }

    #[test]
    fn skips_a_repository_whose_own_config_sets_a_clean_or_process_filter() {
        let output = b"system\0filter.lfs.clean\ngit-lfs clean -- %f\0\
global\0filter.lfs.process\ngit-lfs filter-process\0\
command\0filter.x.clean\ncat\0\
local\0filter.lfs.clean\nevil.exe %f\0\
worktree\0filter.tidy.process\nother.exe\0";

        assert_eq!(
            repository_filters(output),
            vec![
                "filter.lfs.clean".to_string(),
                "filter.tidy.process".to_string()
            ]
        );
        assert!(repository_filters(b"system\0filter.lfs.clean\ngit-lfs clean -- %f\0").is_empty());
        assert!(repository_filters(b"").is_empty());
    }

    #[test]
    fn runs_git_quietly_without_locks_fsmonitor_or_submodules() {
        let git = Git::installed();
        let dir = std::env::temp_dir();
        let command = git.command(&dir, &STATUS);

        assert_eq!(command.get_program(), "git");
        assert_eq!(command.get_current_dir(), Some(dir.as_path()));
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "--no-optional-locks",
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v2",
                "-z",
                "--untracked-files=normal",
                "--ignore-submodules=dirty",
                "--",
                "."
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("safe.directory")));

        let envs: HashMap<_, _> = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(envs.get("GIT_TERMINAL_PROMPT"), Some(&Some("0".into())));
        assert_eq!(envs.get("GIT_DIR"), Some(&None));
        // The system config stays: Git for Windows sets autocrlf and LFS there.
        assert!(!envs.contains_key("GIT_CONFIG_NOSYSTEM"));
        assert!(!envs.contains_key("GIT_CONFIG_GLOBAL"));

        let check = git.command(&dir, &FILTER_CHECK);
        let args: Vec<_> = check
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args[3..],
            [
                "config",
                "--show-scope",
                "-z",
                "--get-regexp",
                r"^filter\..*\.(clean|process)$"
            ]
        );
    }

    #[test]
    fn gives_no_status_when_git_is_not_installed() {
        let temp = TempDir::new("no-git");
        let git = Git::at("scrivon-test-no-such-git-program");

        assert_eq!(status_of(&git, &temp.0), Err(GitFailure::NotInstalled));
        assert_eq!(
            reply(&temp.0, Err(GitFailure::NotInstalled)),
            GitStatusReply::None
        );
        assert_eq!(
            reply(&temp.0, Err(GitFailure::TimedOut)),
            GitStatusReply::TimedOut
        );
    }

    #[test]
    fn stops_reading_past_the_output_limit() {
        assert_eq!(read_capped(&[7u8; 10][..], 10), Ok(vec![7; 10]));
        assert_eq!(read_capped(&[7u8; 11][..], 10), Err(()));
        assert_eq!(read_capped(&b""[..], 10), Ok(vec![]));
    }

    /// A program that prints a lot, and one that takes a while.
    #[cfg(windows)]
    fn chatty_and_slow() -> (Command, Command) {
        let mut chatty = Command::new("cmd");
        chatty.args(["/C", "dir", "/S", r"C:\Windows\System32\drivers"]);
        let mut slow = Command::new("ping");
        slow.args(["-n", "30", "127.0.0.1"]);
        (chatty, slow)
    }

    #[cfg(unix)]
    fn chatty_and_slow() -> (Command, Command) {
        let mut chatty = Command::new("sh");
        chatty.args(["-c", "yes | head -c 100000"]);
        let mut slow = Command::new("sleep");
        slow.arg("30");
        (chatty, slow)
    }

    #[test]
    fn kills_a_command_that_writes_too_much_or_takes_too_long() {
        let (mut chatty, mut slow) = chatty_and_slow();
        for command in [&mut chatty, &mut slow] {
            command
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        }
        let later = Instant::now() + Duration::from_secs(20);
        assert_eq!(
            run_capped(chatty, later, 1000).err(),
            Some(GitFailure::TooMuchOutput)
        );

        let started = Instant::now();
        let soon = started + Duration::from_millis(300);
        assert_eq!(
            run_capped(slow, soon, MAX_GIT_OUTPUT).err(),
            Some(GitFailure::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn checks_the_folder_is_one_the_user_opened() {
        let temp = TempDir::new("scope");
        temp.write("notes/a.md", "a");
        let notes = temp.0.join("notes");
        let real = std::fs::canonicalize(&notes).unwrap();
        let opened = |path: &Path| path.starts_with(&real);

        assert_eq!(allowed_folder(&notes, opened), Ok(notes.clone()));
        assert_eq!(
            allowed_folder(&notes, |_| false),
            Err(OUTSIDE_FOLDER.into())
        );
        assert_eq!(allowed_folder(&temp.0, opened), Err(OUTSIDE_FOLDER.into()));
        assert_eq!(
            allowed_folder(&notes.join("..").join("notes"), |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
        assert_eq!(
            allowed_folder(Path::new("notes"), |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
        assert_eq!(
            allowed_folder(&notes.join("a.md"), |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
        assert_eq!(
            allowed_folder(&temp.0.join("gone"), |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
    }

    /// Runs a plain git command in `dir` for a test's setup.
    fn git_in(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(dir)
            .args([
                "-c",
                "user.name=Scrivon Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "git {args:?}: {output:?}");
    }

    fn git_is_installed() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .is_ok_and(|out| out.status.success())
    }

    #[test]
    fn reads_the_changes_in_a_real_repository() {
        if !git_is_installed() {
            eprintln!("git isn't installed: skipped");
            return;
        }
        let temp = TempDir::new("repo");
        git_in(&temp.0, &["init", "-q"]);
        temp.write("docs/a b.md", "one\n");
        temp.write("keep.md", "keep\n");
        temp.write("docs/ü.md", "ü\n");
        git_in(&temp.0, &["add", "."]);
        git_in(&temp.0, &["commit", "-q", "-m", "first"]);
        temp.write("docs/a b.md", "two\n");
        temp.write("fresh/inner/n.md", "new\n");
        temp.write("added.md", "added\n");
        git_in(&temp.0, &["add", "added.md"]);
        git_in(&temp.0, &["mv", "keep.md", "kept.md"]);
        std::fs::remove_file(temp.0.join("docs/ü.md")).unwrap();

        let index = std::fs::read(temp.0.join(".git/index")).unwrap();
        let mut entries = status_of(&Git::installed(), &temp.0).unwrap();
        entries.sort_by(|a, b| a.path.cmp(&b.path));

        let paths: Vec<_> = entries
            .iter()
            .map(|e| (e.path.as_str(), e.xy.as_str(), e.dir, e.from.as_deref()))
            .collect();
        assert_eq!(
            paths,
            [
                ("added.md", "A.", false, None),
                ("docs/a b.md", ".M", false, None),
                ("docs/ü.md", ".D", false, None),
                ("fresh", "??", true, None),
                ("kept.md", "R.", false, Some("keep.md")),
            ]
        );
        // Read only: plain status would have refreshed the index here, as
        // files changed just after they were added.
        assert_eq!(std::fs::read(temp.0.join(".git/index")).unwrap(), index);
        assert!(!temp.0.join(".git/index.lock").exists());

        // Opened below the top of the repository: paths are from there.
        let docs = status_of(&Git::installed(), &temp.0.join("docs")).unwrap();
        let mut docs: Vec<_> = docs.iter().map(|e| e.path.as_str()).collect();
        docs.sort();
        assert_eq!(docs, ["a b.md", "ü.md"]);
    }

    #[test]
    fn does_not_run_git_status_where_the_repository_sets_a_filter() {
        if !git_is_installed() {
            eprintln!("git isn't installed: skipped");
            return;
        }
        let temp = TempDir::new("filter");
        git_in(&temp.0, &["init", "-q"]);
        git_in(
            &temp.0,
            &["config", "filter.lfs.clean", "scrivon-test-must-not-run %f"],
        );

        assert_eq!(
            status_of(&Git::installed(), &temp.0),
            Err(GitFailure::RepositoryFilters(vec![
                "filter.lfs.clean".into()
            ]))
        );
    }

    #[test]
    fn gives_no_status_outside_a_repository() {
        if !git_is_installed() {
            eprintln!("git isn't installed: skipped");
            return;
        }
        let temp = TempDir::new("plain");
        // Git looks in the folders above too, and would find a repository
        // there (a home folder kept in git, say).
        let above = Command::new("git")
            .current_dir(&temp.0)
            .args(["rev-parse", "--git-dir"])
            .output()
            .unwrap();
        if above.status.success() {
            eprintln!("the temporary folder is in a repository: skipped");
            return;
        }
        let status = status_of(&Git::installed(), &temp.0);
        assert!(matches!(status, Err(GitFailure::Failed(_))), "{status:?}");
    }
}
