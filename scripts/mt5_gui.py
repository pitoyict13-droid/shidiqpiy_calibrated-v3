"""Localhost GUI for MetaTrader 5 demo login and grid executor control.

Run with: python scripts/mt5_gui.py
The page is served only on 127.0.0.1 and every API call needs the per-run token.
"""

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import gui_core

BASE_DIR = Path(__file__).resolve().parent.parent
EXECUTOR = BASE_DIR / "scripts" / "mt5_grid_hft.py"
REMOTE_NEWS = (
    "https://raw.githubusercontent.com/pitoyict13-droid/aiterminaltrading/main/data/calendar.json"
)
PAIRS = ("EUR/USD", "GBP/USD", "USD/JPY")
MODE_LABEL = {0: "DEMO", 1: "CONTEST", 2: "REAL"}
MAX_BODY = 64 * 1024
DETECT_TTL = 30.0
TOKEN = secrets.token_urlsafe(24)

MT5_LOCK = threading.RLock()
DETECT_LOCK = threading.Lock()
STATE = {
    "connected": False,
    "snapshot": None,
    "stale": False,
    "checked_at": None,
    "path": None,
}
DETECT = {"at": 0.0, "data": None}

_mt5 = None


def mt5():
    global _mt5
    if _mt5 is None:
        import MetaTrader5
        _mt5 = MetaTrader5
    return _mt5


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def powershell_json(command, timeout=6):
    script = "$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + command
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return gui_core.parse_process_json(result.stdout)


def running_terminals():
    command = (
        "Get-CimInstance Win32_Process -Filter \"Name='terminal64.exe'\" | "
        "Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
    )
    return powershell_json(command)


def external_executor():
    command = (
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | "
        "Where-Object { $_.CommandLine -like '*mt5_grid_hft.py*' } | "
        "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    )
    for proc in powershell_json(command, timeout=5):
        command_line = proc.get("cmd") or ""
        if "mt5_grid_hft.py" in command_line:
            return {"pid": proc.get("pid"), "command": command_line}
    return None


def _scan_terminals():
    found = {}

    def add(path, source):
        key = os.path.normcase(path)
        item = found.get(key)
        if item is None:
            item = {"path": path, "sources": set(), "running": False, "pid": None}
            found[key] = item
        item["sources"].add(source)

    roots = []
    for env in ("ProgramFiles", "ProgramFiles(x86)"):
        value = os.environ.get(env)
        if value:
            roots.append(value)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        roots.append(os.path.join(local, "Programs"))
    for root in roots:
        try:
            entries = list(os.scandir(root))
        except OSError:
            continue
        for entry in entries:
            try:
                if not entry.is_dir():
                    continue
            except OSError:
                continue
            lowered = entry.name.lower()
            if "metatrader 5" not in lowered and "mt5" not in lowered:
                continue
            exe = os.path.join(entry.path, gui_core.TERMINAL_EXE)
            if os.path.isfile(exe):
                add(exe, "install")

    appdata = os.environ.get("APPDATA")
    if appdata:
        base = os.path.join(appdata, "MetaQuotes", "Terminal")
        try:
            term_dirs = list(os.scandir(base))
        except OSError:
            term_dirs = []
        for entry in term_dirs:
            origin = os.path.join(entry.path, "origin.txt")
            if not os.path.isfile(origin):
                continue
            try:
                with open(origin, "rb") as handle:
                    raw = handle.read(4096)
            except OSError:
                continue
            path = gui_core.normalize_terminal_path(gui_core.parse_origin_text(raw))
            if path:
                add(path, "origin")

    for proc in running_terminals():
        exe = proc.get("path")
        if not exe:
            continue
        add(exe, "process")
        item = found.get(os.path.normcase(exe))
        if item is not None:
            item["running"] = True
            item["pid"] = proc.get("pid")

    result = []
    for key, item in sorted(found.items()):
        path = item["path"]
        result.append({
            "id": hashlib.sha1(key.encode("utf-8")).hexdigest()[:10],
            "name": os.path.basename(os.path.dirname(path)) or path,
            "path": path,
            "running": item["running"],
            "pid": item["pid"],
            "sources": sorted(item["sources"]),
        })
    return result


def detect_terminals(force=False):
    now = time.time()
    with DETECT_LOCK:
        if not force and DETECT["data"] is not None and now - DETECT["at"] < DETECT_TTL:
            return DETECT["data"]
        data = _scan_terminals()
        DETECT.update(at=now, data=data)
        return data


def connect_mt5(path=None, login=None, password=None, server=None):
    kwargs = {}
    if path:
        kwargs["path"] = path
    if login is not None:
        kwargs.update({"login": int(login), "password": password, "server": server})
    try:
        with MT5_LOCK:
            ok = mt5().initialize(**kwargs)
    except Exception as exc:
        return False, f"initialize error: {exc}"
    if not ok:
        return False, str(mt5().last_error())
    return True, None


def read_account():
    from mt5_bridge import PAIR_SYMBOLS, resolve_symbol

    with MT5_LOCK:
        module = mt5()
        info = module.account_info()
        terminal = module.terminal_info()
        if info is None:
            return None
        pairs = []
        for pair in PAIRS:
            name = resolve_symbol(PAIR_SYMBOLS[pair])
            pairs.append({"pair": pair, "available": bool(name)})
        terminal_path = getattr(terminal, "path", None) if terminal else None
    terminal_exe = None
    if terminal_path:
        candidate = os.path.join(terminal_path, gui_core.TERMINAL_EXE)
        terminal_exe = candidate if os.path.isfile(candidate) else terminal_path
    return {
        "login": info.login,
        "login_masked": gui_core.mask_login(info.login),
        "company": info.company,
        "server": info.server,
        "trade_mode": info.trade_mode,
        "mode": MODE_LABEL.get(info.trade_mode, str(info.trade_mode)),
        "balance": info.balance,
        "equity": info.equity,
        "currency": info.currency,
        "trade_allowed": bool(info.trade_allowed),
        "leverage": info.leverage,
        "terminal": terminal_path,
        "terminal_exe": terminal_exe,
        "pairs": pairs,
    }


def attach(path):
    ok, err = connect_mt5(path)
    if not ok:
        return None, err
    snap = read_account()
    if snap is None:
        with MT5_LOCK:
            mt5().shutdown()
        return None, "account_info kosong setelah initialize"
    STATE.update(connected=True, snapshot=snap, stale=False,
                 checked_at=now_iso(), path=path or snap.get("terminal_exe"))
    return snap, None


def login(path, login_id, password, server):
    ok, err = connect_mt5(path, login=login_id, password=password, server=server)
    if not ok:
        return None, err, "AUTH_FAILED"
    snap = read_account()
    if snap is None:
        with MT5_LOCK:
            mt5().shutdown()
        STATE.update(connected=False, snapshot=None, stale=False)
        return None, "account_info kosong setelah login", "MT5_INIT_FAILED"
    if snap["trade_mode"] != 0:
        with MT5_LOCK:
            mt5().shutdown()
        STATE.update(connected=False, snapshot=None, stale=False)
        return None, "Akun bukan DEMO; GUI hanya mengizinkan login demo.", "NOT_DEMO"
    STATE.update(connected=True, snapshot=snap, stale=False,
                 checked_at=now_iso(), path=path or snap.get("terminal_exe"))
    return snap, None, None


def status_payload():
    if BOT.is_running():
        return {
            "mt5": {
                "connected": False,
                "stale": True,
                "checked_at": STATE["checked_at"],
                "account": STATE["snapshot"],
            },
            "bot": BOT.snapshot(),
        }
    if STATE["connected"]:
        snap = read_account()
        if snap is None:
            STATE["connected"] = False
            STATE["stale"] = False
        else:
            STATE["snapshot"] = snap
            STATE["checked_at"] = now_iso()
            STATE["stale"] = False
    return {
        "mt5": {
            "connected": STATE["connected"],
            "stale": STATE["stale"],
            "checked_at": STATE["checked_at"],
            "account": STATE["snapshot"],
        },
        "bot": BOT.snapshot(),
    }


class BusyError(RuntimeError):
    pass


class BotController:
    def __init__(self, on_exit=None):
        self.lock = threading.Lock()
        self.proc = None
        self.state = "IDLE"
        self.enable = False
        self.started_at = None
        self.exit_code = None
        self.argv = []
        self.lines = gui_core.RingBuffer()
        self.on_exit = on_exit
        self.ignore_session = False

    def is_running(self):
        proc = self.proc
        return proc is not None and proc.poll() is None

    def start(self, argv, enable=False, ignore_session=False):
        with self.lock:
            if self.is_running():
                raise BusyError("Bot sudah berjalan")
            env = dict(os.environ)
            env["PYTHONIOENCODING"] = "utf-8"
            self.proc = subprocess.Popen(
                argv, cwd=str(BASE_DIR), stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                env=env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
            )
            self.state = "RUNNING"
            self.enable = bool(enable)
            self.ignore_session = bool(ignore_session)
            self.started_at = now_iso()
            self.exit_code = None
            self.argv = list(argv)
            self.lines = gui_core.RingBuffer()
            proc = self.proc
        threading.Thread(target=self._reader, args=(proc,), daemon=True).start()
        return self.snapshot()

    def _reader(self, proc):
        try:
            for line in proc.stdout:
                self.lines.append(line.rstrip("\r\n"))
        except (OSError, ValueError):
            pass
        finally:
            try:
                proc.stdout.close()
            except (AttributeError, OSError):
                pass
            try:
                code = proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                code = proc.wait()
            with self.lock:
                self.exit_code = code
                if self.state in ("RUNNING", "STOPPING"):
                    self.state = "EXITED"
            if self.on_exit:
                try:
                    self.on_exit(code)
                except Exception:
                    pass

    def stop(self, wait=5.0):
        proc = self.proc
        if proc is None or proc.poll() is not None:
            return self.snapshot()
        with self.lock:
            self.state = "STOPPING"
        proc.terminate()
        try:
            proc.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
        return self.snapshot()

    def snapshot(self):
        with self.lock:
            running = self.proc is not None and self.proc.poll() is None
            if not running and self.state in ("RUNNING", "STOPPING"):
                self.state = "EXITED"
            return {
                "state": self.state,
                "running": running,
                "pid": self.proc.pid if self.proc else None,
                "enable": self.enable,
                "ignore_session": self.ignore_session,
                "started_at": self.started_at,
                "exit_code": self.exit_code,
            }


def bot_exited(code):
    STATE["stale"] = True
    STATE["connected"] = False
    threading.Thread(target=reattach, daemon=True).start()


def reattach():
    time.sleep(1.0)
    if BOT.is_running():
        return
    path = STATE.get("path")
    ok, _err = connect_mt5(path)
    if not ok:
        return
    snap = read_account()
    if snap is None:
        with MT5_LOCK:
            mt5().shutdown()
        return
    STATE.update(connected=True, snapshot=snap, stale=False,
                 checked_at=now_iso(), path=path or snap.get("terminal_exe"))


BOT = BotController()
BOT.on_exit = bot_exited


class Handler(BaseHTTPRequestHandler):
    server_version = "MT5GridGUI/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _host_ok(self):
        return gui_core.check_host(self.headers.get("Host"))

    def _token_ok(self):
        return gui_core.token_ok(TOKEN, self.headers.get("X-GUI-Token"))

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        data = body if isinstance(body, bytes) else str(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, code, payload):
        self._send(code, json.dumps(payload, ensure_ascii=False))

    def _error(self, code, err_code, message, last_error=None):
        err = {"code": err_code, "message": message}
        if last_error is not None:
            err["last_error"] = last_error
        self._json(code, {"ok": False, "error": err})

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length > MAX_BODY:
            return None
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def do_GET(self):
        if not self._host_ok():
            self._error(403, "FORBIDDEN_HOST", "Host tidak diizinkan")
            return
        parts = urlsplit(self.path)
        if parts.path == "/":
            nonce = secrets.token_urlsafe(16)
            html = HTML_PAGE.replace("__TOKEN__", TOKEN).replace("__NONCE__", nonce)
            self._send(200, html, "text/html; charset=utf-8", {
                "Content-Security-Policy": (
                    "default-src 'self'; style-src 'nonce-%s'; script-src 'nonce-%s'; "
                    "connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'"
                    % (nonce, nonce)
                ),
                "Referrer-Policy": "no-referrer",
            })
            return
        if not self._token_ok():
            self._error(403, "BAD_TOKEN", "Token sesi tidak valid")
            return
        try:
            if parts.path == "/api/detect":
                force = parse_qs(parts.query).get("force", ["0"])[0] == "1"
                self._json(200, {"ok": True, "candidates": detect_terminals(force)})
                return
            if parts.path == "/api/status":
                self._json(200, dict(ok=True, **status_payload()))
                return
            if parts.path == "/api/log":
                since_text = parse_qs(parts.query).get("since", ["0"])[0]
                since = int(since_text) if since_text.isdigit() else 0
                runtime = BOT.snapshot()
                self._json(200, {
                    "ok": True,
                    "lines": BOT.lines.since(since),
                    "next": BOT.lines.next_seq(),
                    "dropped": BOT.lines.dropped(),
                    "running": runtime["running"],
                })
                return
        except Exception as exc:
            self._error(500, "INTERNAL", str(exc))
            return
        self._error(404, "NOT_FOUND", "Endpoint tidak dikenal")

    def do_POST(self):
        if not self._host_ok():
            self._error(403, "FORBIDDEN_HOST", "Host tidak diizinkan")
            return
        if not self._token_ok():
            self._error(403, "BAD_TOKEN", "Token sesi tidak valid")
            return
        body = self._read_body()
        if body is None:
            self._error(400, "BAD_REQUEST", "Body JSON tidak valid atau terlalu besar")
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/attach":
                self._handle_attach(body)
            elif path == "/api/login":
                self._handle_login(body)
            elif path == "/api/logout":
                self._handle_logout()
            elif path == "/api/bot/start":
                self._handle_bot_start(body)
            elif path == "/api/bot/stop":
                self._handle_bot_stop()
            else:
                self._error(404, "NOT_FOUND", "Endpoint tidak dikenal")
        except Exception as exc:
            self._error(500, "INTERNAL", str(exc))

    def _handle_attach(self, body):
        if BOT.is_running():
            self._error(409, "BOT_BUSY", "Bot sedang berjalan")
            return
        path = body.get("path") or None
        if path:
            path = gui_core.normalize_terminal_path(path)
            if not path:
                self._error(400, "TERMINAL_NOT_FOUND", "Path terminal64.exe tidak valid")
                return
        snap, err = attach(path)
        if err:
            self._error(502, "MT5_INIT_FAILED", "Gagal hubungkan MT5", err)
            return
        self._json(200, {"ok": True, "account": snap, "path": STATE.get("path")})

    def _handle_login(self, body):
        errors = gui_core.validate_login_fields(
            body.get("login"), body.get("password"), body.get("server"))
        if errors:
            self._error(400, "BAD_REQUEST", "; ".join(errors))
            return
        if BOT.is_running():
            self._error(409, "BOT_BUSY", "Bot sedang berjalan")
            return
        path = body.get("path") or None
        if path:
            path = gui_core.normalize_terminal_path(path)
            if not path:
                self._error(400, "TERMINAL_NOT_FOUND", "Path terminal64.exe tidak valid")
                return
        snap, err, err_code = login(
            path, body.get("login"), body.get("password"), body.get("server"))
        if err:
            http_code = {"AUTH_FAILED": 401, "NOT_DEMO": 403, "MT5_INIT_FAILED": 502}.get(
                err_code, 502)
            self._error(http_code, err_code, err)
            return
        self._json(200, {"ok": True, "account": snap, "path": STATE.get("path")})

    def _handle_logout(self):
        if _mt5 is not None:
            with MT5_LOCK:
                try:
                    _mt5.shutdown()
                except Exception:
                    pass
        STATE.update(connected=False, snapshot=None, stale=False, checked_at=None, path=None)
        self._json(200, {"ok": True})

    def _handle_bot_start(self, body):
        if BOT.is_running():
            self._error(409, "BOT_BUSY", "Bot sudah berjalan")
            return
        snap = STATE["snapshot"] if STATE["connected"] else None
        if snap is None:
            self._error(403, "DEMO_REQUIRED", "Hubungkan atau login akun demo dulu")
            return
        if snap.get("trade_mode") != 0:
            self._error(403, "NOT_DEMO", "Akun bukan DEMO; start ditolak")
            return
        enable = bool(body.get("enable"))
        ignore_session = bool(body.get("ignore_session"))
        other = external_executor()
        if other:
            self._error(409, "EXTERNAL_BOT",
                        "Executor lain berjalan (pid %s)" % other.get("pid"))
            return
        with MT5_LOCK:
            if _mt5 is not None:
                try:
                    _mt5.shutdown()
                except Exception:
                    pass
        STATE.update(connected=False, stale=True)
        argv = gui_core.build_bot_argv(
            sys.executable, EXECUTOR, REMOTE_NEWS,
            path=STATE.get("path"), enable=enable, ignore_session=ignore_session)
        BOT.start(argv, enable, ignore_session)
        self._json(200, {"ok": True, "bot": BOT.snapshot()})

    def _handle_bot_stop(self):
        if not BOT.is_running():
            self._error(409, "BOT_BUSY", "Bot tidak berjalan")
            return
        BOT.stop()
        self._json(200, {"ok": True, "bot": BOT.snapshot()})


HTML_PAGE = """<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="gui-token" content="__TOKEN__">
<title>MT5 Grid Console (Demo)</title>
<style nonce="__NONCE__">
:root{--bg:#0f1419;--panel:#171e26;--line:#2a3542;--txt:#e6edf3;--dim:#8b98a5;--ok:#1baf7a;--warn:#d29922;--bad:#d95926;--acc:#2f81f7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center;justify-content:space-between}
h1{font-size:16px;margin:0}
main{max-width:1100px;margin:0 auto;padding:18px;display:grid;gap:14px}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 10px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
label{display:block;color:var(--dim);font-size:12px;margin:6px 0 2px}
label.inline{display:flex;gap:6px;align-items:center;margin:0;color:var(--txt);font-size:13px}
input{background:#0e141b;border:1px solid var(--line);color:var(--txt);border-radius:6px;padding:7px 9px;width:100%}
input[type=checkbox]{width:auto}
button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:8px 12px;cursor:pointer;font-weight:600}
button.secondary{background:#263140}
button.danger{background:var(--bad)}
button:disabled{opacity:.45;cursor:not-allowed}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kv{background:#0e141b;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.kv b{display:block;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700}
.badge.demo{background:rgba(27,175,122,.15);color:var(--ok)}
.badge.real{background:rgba(217,89,38,.15);color:var(--bad)}
.badge.muted{background:#263140;color:var(--dim)}
ul.term{list-style:none;margin:0;padding:0;display:grid;gap:8px}
ul.term li{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.path{color:var(--dim);font-size:12px;word-break:break-all}
pre.log{background:#080c10;border:1px solid var(--line);border-radius:8px;padding:10px;height:280px;overflow:auto;margin:0;font:12px/1.4 Consolas,monospace;white-space:pre-wrap}
.msg{display:none;border-radius:8px;padding:8px 10px;margin-top:8px}
.msg.show{display:block}
.msg.err{background:rgba(217,89,38,.12);border:1px solid rgba(217,89,38,.4);color:#ffb59a}
.msg.ok{background:rgba(27,175,122,.12);border:1px solid rgba(27,175,122,.4);color:#8ee7c4}
.note{color:var(--dim);font-size:12px;margin-top:8px}
.warn{color:var(--warn);font-size:12px}
.mt{margin-top:10px}
</style>
</head>
<body>
<header>
  <div>
    <h1>MT5 Grid Console</h1>
    <div class="note">Demo only · server 127.0.0.1 · token per sesi</div>
  </div>
  <div id="botChip" class="badge muted">BOT: IDLE</div>
</header>
<main>
  <section>
    <h2>1 · Deteksi Terminal</h2>
    <div class="row"><button id="btnDetect">Deteksi ulang</button></div>
    <ul id="termList" class="term mt"></ul>
    <div class="note">Deteksi hanya membaca folder instalasi dan proses; terminal tidak dijalankan.</div>  </section>

  <section>
    <h2>2 · Terminal &amp; Login Akun Demo</h2>
    <div class="grid">
      <div>
        <label for="path">Path terminal64.exe (opsional)</label>
        <input id="path" placeholder="C:\\Program Files\\MetaTrader 5\\terminal64.exe">
      </div>
      <div><label for="server">Server</label><input id="server" placeholder="FBS-Demo"></div>
      <div><label for="login">Login</label><input id="login" inputmode="numeric" autocomplete="off"></div>
      <div><label for="password">Password</label><input id="password" type="password" autocomplete="off"></div>
    </div>
    <div class="row mt">
      <button id="btnAttach" class="secondary">Hubungkan (tanpa ganti akun)</button>
      <button id="btnLogin">Login Demo</button>
      <button id="btnLogout" class="secondary">Putuskan</button>
    </div>
    <div class="warn mt">Login lewat GUI mengganti sesi akun pada terminal yang dipilih. Password tidak disimpan.</div>
    <div id="msg" class="msg"></div>
  </section>

  <section>
    <h2>3 · Status Akun</h2>
    <div id="acct" class="grid"></div>
    <div id="pairs" class="row mt"></div>
  </section>

  <section>
    <h2>4 · Kontrol Bot</h2>
    <div class="row">
      <button id="btnDry" disabled>Jalankan DRY-RUN</button>
      <button id="btnLive" class="danger" disabled>Jalankan DEMO (kirim order)</button>
      <button id="btnStop" class="secondary" disabled>Stop</button>
      <label class="inline"><input type="checkbox" id="ignoreSession"> Abaikan sesi (uji)</label>
      <span id="botInfo" class="note"></span>
    </div>
    <div class="warn mt">DRY-RUN hanya paper book. Tombol DEMO mengirim order nyata ke akun demo (lot 0.01).</div>
    <div class="note">Abaikan sesi memungkinkan entry di luar jam London/NY; filter spread dan news tetap berlaku.</div>
  </section>

  <section>
    <h2>5 · Log Executor</h2>
    <div class="row">
      <label class="inline"><input type="checkbox" id="follow" checked> Ikuti log</label>
      <button id="btnClear" class="secondary">Bersihkan tampilan</button>
    </div>
    <pre id="log" class="log mt"></pre>
  </section>
</main>
<script nonce="__NONCE__">
const token = document.querySelector('meta[name="gui-token"]').content;
const $ = (id) => document.getElementById(id);
let logSeq = 0;
let account = null;

function showMsg(text, ok) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'msg show ' + (ok ? 'ok' : 'err');
  clearTimeout(showMsg.timer);
  showMsg.timer = setTimeout(() => { el.className = 'msg'; }, 9000);
}

async function api(path, body) {
  const headers = {'X-GUI-Token': token};
  const opt = {headers};
  if (body !== undefined) {
    opt.method = 'POST';
    headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(path, opt);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || data.ok === false) {
    const err = data.error || {};
    let msg = err.message || ('HTTP ' + res.status);
    if (err.last_error !== undefined && err.last_error !== null) {
      msg += ' [' + JSON.stringify(err.last_error) + ']';
    }
    throw new Error(msg);
  }
  return data;
}

function fmtNum(value) {
  if (value === null || value === undefined) return '-';
  return Number(value).toLocaleString('id-ID', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function badge(text, cls) {
  const el = document.createElement('span');
  el.className = 'badge ' + cls;
  el.textContent = text;
  return el;
}

function kv(parent, label, value, extra) {
  const box = document.createElement('div');
  box.className = 'kv';
  const head = document.createElement('b');
  head.textContent = label;
  box.appendChild(head);
  if (extra) box.appendChild(extra);
  else box.appendChild(document.createTextNode(value));
  parent.appendChild(box);
}

function renderTerms(list) {
  const ul = $('termList');
  ul.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = 'Tidak ada terminal terdeteksi. Isi path manual di bawah.';
    ul.appendChild(li);
    return;
  }
  for (const term of list) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = term.name;
    left.appendChild(name);
    left.appendChild(document.createTextNode(' '));
    left.appendChild(badge(term.running ? 'berjalan' : 'tidak jalan', term.running ? 'demo' : 'muted'));
    const path = document.createElement('div');
    path.className = 'path';
    path.textContent = term.path;
    left.appendChild(path);
    li.appendChild(left);
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'Pakai';
    btn.addEventListener('click', () => {
      $('path').value = term.path;
      showMsg('Path terminal dipilih.', true);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function renderAccount(acct, mt5) {
  const grid = $('acct');
  grid.textContent = '';
  const pairs = $('pairs');
  pairs.textContent = '';
  if (!acct) {
    kv(grid, 'Status', (mt5 && mt5.stale) ? 'Bot berjalan (status beku)' : 'Belum terhubung');
    return;
  }
  kv(grid, 'Akun', acct.login_masked);
  kv(grid, 'Mode', '', badge(acct.mode, acct.trade_mode === 0 ? 'demo' : 'real'));
  kv(grid, 'Server', acct.server);
  kv(grid, 'Broker', acct.company);
  kv(grid, 'Balance', fmtNum(acct.balance) + ' ' + acct.currency);
  kv(grid, 'Equity', fmtNum(acct.equity) + ' ' + acct.currency);
  kv(grid, 'Trade allowed', acct.trade_allowed ? 'ya' : 'tidak');
  kv(grid, 'Leverage', '1:' + acct.leverage);
  for (const pair of acct.pairs || []) {
    pairs.appendChild(badge(pair.pair + (pair.available ? '' : ' (tidak ada)'),
                            pair.available ? 'muted' : 'real'));
  }
}

function renderBot(bot) {
  const chip = $('botChip');
  chip.textContent = 'BOT: ' + bot.state;
  chip.className = 'badge ' + (bot.running ? 'demo' : 'muted');
  const demo = !!account && account.trade_mode === 0;
  $('btnDry').disabled = bot.running || !demo;
  $('btnLive').disabled = bot.running || !demo;
  $('btnStop').disabled = !bot.running;
  let info = '';
  if (bot.pid) info = 'pid ' + bot.pid + (bot.enable ? ' · kirim order' : ' · dry-run');
  if (bot.ignore_session) info += ' · tanpa sesi';
  if (!bot.running && bot.exit_code !== null && bot.exit_code !== undefined) {
    info += (info ? ' · ' : '') + 'exit ' + bot.exit_code;
  }
  $('botInfo').textContent = info;
}

async function pollStatus() {
  try {
    const data = await api('/api/status');
    account = data.mt5.account || null;
    renderAccount(account, data.mt5);
    renderBot(data.bot);
  } catch (e) {}
}

async function pollLog() {
  try {
    const data = await api('/api/log?since=' + logSeq);
    if (!data.lines.length) return;
    const pre = $('log');
    let text = pre.textContent;
    for (const line of data.lines) text += line.text + '\\n';
    const parts = text.split('\\n');
    if (parts.length > 600) text = parts.slice(-600).join('\\n');
    pre.textContent = text;
    logSeq = data.next;
    if ($('follow').checked) pre.scrollTop = pre.scrollHeight;
  } catch (e) {}
}

$('btnDetect').addEventListener('click', async () => {
  try {
    const data = await api('/api/detect?force=1');
    renderTerms(data.candidates);
  } catch (e) { showMsg(e.message, false); }
});

$('btnAttach').addEventListener('click', async () => {
  const path = $('path').value.trim();
  try {
    await api('/api/attach', {path: path || null});
    showMsg('Terhubung ke akun yang sedang login.', true);
    pollStatus();
  } catch (e) { showMsg(e.message, false); }
});

$('btnLogin').addEventListener('click', async () => {
  const payload = {
    path: $('path').value.trim() || null,
    login: $('login').value.trim(),
    password: $('password').value,
    server: $('server').value.trim()
  };
  if (!payload.login || !payload.password || !payload.server) {
    showMsg('Login, password, dan server wajib diisi.', false);
    return;
  }
  if (!confirm('Login akan mengganti sesi akun pada terminal yang dipilih. Lanjut?')) return;
  try {
    await api('/api/login', payload);
    $('password').value = '';
    showMsg('Login demo berhasil.', true);
    pollStatus();
  } catch (e) {
    $('password').value = '';
    showMsg(e.message, false);
  }
});

$('btnLogout').addEventListener('click', async () => {
  try {
    await api('/api/logout', {});
    showMsg('Koneksi MT5 ditutup.', true);
    pollStatus();
  } catch (e) { showMsg(e.message, false); }
});

function startBot(enable) {
  return api('/api/bot/start', {enable: enable, ignore_session: $('ignoreSession').checked}).then(() => {
    logSeq = 0;
    $('log').textContent = '';
    pollStatus();
  }).catch((e) => showMsg(e.message, false));
}

$('btnDry').addEventListener('click', () => startBot(false));
$('btnLive').addEventListener('click', () => {
  if (confirm('Kirim order nyata ke akun DEMO? Lot 0.01, SL 15 pips, stop harian $5.')) {
    startBot(true);
  }
});
$('btnStop').addEventListener('click', async () => {
  try {
    await api('/api/bot/stop', {});
    showMsg('Perintah stop dikirim.', true);
    pollStatus();
  } catch (e) { showMsg(e.message, false); }
});
$('btnClear').addEventListener('click', () => { $('log').textContent = ''; });

(async function init() {
  $('termList').textContent = 'Mendeteksi terminal...';
  $('acct').textContent = 'Memuat status...';
  try {
    const data = await api('/api/detect');
    renderTerms(data.candidates);
  } catch (e) { showMsg(e.message, false); }
  pollStatus();
})();
setInterval(pollStatus, 2000);
setInterval(pollLog, 1000);
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description="GUI localhost MT5 (demo) + grid executor")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    httpd = None
    for port in range(args.port, args.port + 11):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        raise SystemExit(f"Tidak ada port kosong di {args.port}-{args.port + 10}")
    httpd.daemon_threads = True

    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"MT5 GUI siap di {url} (Ctrl+C untuk berhenti)", flush=True)
    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("GUI dihentikan.", flush=True)
    finally:
        httpd.server_close()
        if _mt5 is not None:
            with MT5_LOCK:
                try:
                    _mt5.shutdown()
                except Exception:
                    pass


if __name__ == "__main__":
    main()
