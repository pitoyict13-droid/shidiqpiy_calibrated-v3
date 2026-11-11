"""Pure helpers for the localhost MT5 GUI.

No MetaTrader5 import here so the logic is unit-testable anywhere.
"""

import hmac
import json
import os
import threading
from collections import deque
from datetime import datetime

TERMINAL_EXE = "terminal64.exe"
ALLOWED_HOSTS = {"127.0.0.1", "localhost"}


def normalize_terminal_path(path):
    if not path:
        return None
    raw = str(path)
    if "\r" in raw or "\n" in raw:
        return None
    text = raw.strip().strip('"')
    if not text or len(text) > 260:
        return None
    expanded = os.path.abspath(os.path.expandvars(os.path.expanduser(text)))
    if os.path.basename(expanded).lower() != TERMINAL_EXE:
        return None
    if not os.path.isfile(expanded):
        return None
    return expanded


def is_valid_terminal_path(path):
    return normalize_terminal_path(path) is not None


def parse_origin_text(raw):
    if not raw:
        return None
    if isinstance(raw, str):
        text = raw
    elif raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        try:
            text = raw.decode("utf-16")
        except UnicodeDecodeError:
            return None
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = raw.decode("mbcs")
            except (UnicodeDecodeError, LookupError):
                return None
    text = text.replace("\x00", "").strip()
    return text or None


def mask_login(login):
    text = str(login or "").strip()
    if len(text) <= 4:
        return "*" * len(text)
    return text[:2] + "*" * (len(text) - 4) + text[-2:]


def redact(text, secrets):
    out = str(text or "")
    for secret in secrets or []:
        secret = str(secret or "")
        if len(secret) >= 3:
            out = out.replace(secret, "***")
    return out


def token_ok(expected, provided):
    if not expected or not provided:
        return False
    return hmac.compare_digest(str(expected), str(provided))


def check_host(header_value):
    if not header_value:
        return False
    host = str(header_value).strip().lower()
    if host.startswith("["):
        return False
    if ":" in host:
        host = host.rsplit(":", 1)[0]
    return host in ALLOWED_HOSTS


def validate_login_fields(login, password, server):
    errors = []
    login_text = str(login or "").strip()
    if not login_text.isdigit() or not 3 <= len(login_text) <= 12:
        errors.append("login harus angka 3-12 digit")
    if not password:
        errors.append("password wajib diisi")
    server_text = str(server or "").strip()
    if not server_text or len(server_text) > 64 or "\r" in server_text or "\n" in server_text:
        errors.append("server tidak valid")
    return errors


def parse_process_json(text):
    text = (text or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except ValueError:
        return []
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        return []
    out = []
    for item in data:
        if not isinstance(item, dict):
            continue
        pid = item.get("ProcessId", item.get("PID"))
        exe = item.get("ExecutablePath", item.get("Path"))
        cmd = item.get("CommandLine")
        out.append({
            "pid": int(pid) if str(pid).isdigit() else None,
            "path": str(exe).strip() if exe else None,
            "cmd": str(cmd).strip() if cmd else None,
        })
    return out


def build_bot_argv(python, script, news, path=None, enable=False, interval=1,
                   ignore_session=False):
    argv = [str(python), "-u", str(script), "--interval", str(interval), "--news", str(news)]
    if path:
        argv += ["--path", str(path)]
    if enable:
        argv.append("--enable")
    if ignore_session:
        argv.append("--ignore-session")
    return argv


class RingBuffer:
    def __init__(self, maxlen=2000):
        self._lines = deque(maxlen=maxlen)
        self._seq = 0
        self._dropped = 0
        self._lock = threading.Lock()

    def append(self, text):
        with self._lock:
            self._seq += 1
            if len(self._lines) == self._lines.maxlen:
                self._dropped += 1
            self._lines.append({
                "seq": self._seq,
                "t": datetime.now().strftime("%H:%M:%S"),
                "text": text,
            })
            return self._seq

    def since(self, seq):
        with self._lock:
            return [dict(item) for item in self._lines if item["seq"] > seq]

    def next_seq(self):
        with self._lock:
            return self._seq

    def dropped(self):
        with self._lock:
            return self._dropped
