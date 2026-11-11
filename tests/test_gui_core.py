import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import gui_core as gc


def make_exe(directory):
    exe = Path(directory) / "terminal64.exe"
    exe.write_bytes(b"")
    return exe


class PathTests(unittest.TestCase):
    def test_valid_terminal_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            exe = make_exe(tmp)
            self.assertTrue(gc.is_valid_terminal_path(str(exe)))
            self.assertFalse(gc.is_valid_terminal_path(str(Path(tmp) / "other.exe")))
            self.assertFalse(gc.is_valid_terminal_path("terminal64.exe"))
            self.assertFalse(gc.is_valid_terminal_path(str(exe) + "\r\n"))

    def test_quoted_path_and_env_var(self):
        with tempfile.TemporaryDirectory() as tmp:
            exe = make_exe(tmp)
            os.environ["GUI_TEST_DIR"] = tmp
            try:
                normalized = gc.normalize_terminal_path('"%GUI_TEST_DIR%\\terminal64.exe"')
            finally:
                os.environ.pop("GUI_TEST_DIR", None)
            self.assertIsNotNone(normalized)
            self.assertEqual(os.path.normcase(normalized), os.path.normcase(str(exe)))


class OriginTests(unittest.TestCase):
    def test_utf8_bom(self):
        raw = b"\xef\xbb\xbfC:\\Program Files\\MetaTrader 5\\terminal64.exe\r\n"
        self.assertEqual(gc.parse_origin_text(raw),
                         "C:\\Program Files\\MetaTrader 5\\terminal64.exe")

    def test_utf16(self):
        raw = "D:\\MT5\\terminal64.exe".encode("utf-16")
        self.assertEqual(gc.parse_origin_text(raw), "D:\\MT5\\terminal64.exe")

    def test_empty(self):
        self.assertIsNone(gc.parse_origin_text(b""))
        self.assertIsNone(gc.parse_origin_text(b"  \r\n"))


class SecurityTests(unittest.TestCase):
    def test_mask_login(self):
        self.assertEqual(gc.mask_login("106836988"), "10*****88")
        self.assertEqual(gc.mask_login("123"), "***")

    def test_redact(self):
        self.assertEqual(gc.redact("pass=hunter2", ["hunter2"]), "pass=***")
        self.assertEqual(gc.redact("abc", ["a"]), "abc")

    def test_token_ok(self):
        self.assertTrue(gc.token_ok("abc123", "abc123"))
        self.assertFalse(gc.token_ok("abc123", "abc124"))
        self.assertFalse(gc.token_ok("", ""))
        self.assertFalse(gc.token_ok("abc123", None))

    def test_check_host(self):
        self.assertTrue(gc.check_host("127.0.0.1:8765"))
        self.assertTrue(gc.check_host("localhost"))
        self.assertTrue(gc.check_host("LocalHost:9000"))
        self.assertFalse(gc.check_host("evil.test"))
        self.assertFalse(gc.check_host("127.0.0.1.evil.test"))
        self.assertFalse(gc.check_host("[::1]:8765"))
        self.assertFalse(gc.check_host(None))


class ValidationTests(unittest.TestCase):
    def test_login_fields(self):
        self.assertEqual(gc.validate_login_fields("106836988", "secret", "FBS-Demo"), [])
        self.assertTrue(gc.validate_login_fields("", "secret", "FBS-Demo"))
        self.assertTrue(gc.validate_login_fields("12", "secret", "FBS-Demo"))
        self.assertTrue(gc.validate_login_fields("abc", "secret", "FBS-Demo"))
        self.assertTrue(gc.validate_login_fields("106836988", "", "FBS-Demo"))
        self.assertTrue(gc.validate_login_fields("106836988", "secret", ""))

    def test_build_bot_argv(self):
        argv = gc.build_bot_argv("python.exe", "grid.py", "news.json",
                                 path="C:\\MT5\\terminal64.exe", enable=True)
        self.assertEqual(argv[:6], ["python.exe", "-u", "grid.py", "--interval", "1", "--news"])
        self.assertIn("--path", argv)
        self.assertIn("C:\\MT5\\terminal64.exe", argv)
        self.assertEqual(argv[-1], "--enable")
        self.assertNotIn("--enable", gc.build_bot_argv("python.exe", "grid.py", "news.json"))
        self.assertEqual(
            gc.build_bot_argv("python.exe", "grid.py", "news.json", ignore_session=True)[-1],
            "--ignore-session")
        self.assertNotIn(
            "--ignore-session", gc.build_bot_argv("python.exe", "grid.py", "news.json"))


class ProcessJsonTests(unittest.TestCase):
    def test_single_object(self):
        out = gc.parse_process_json('{"ProcessId": 42, "ExecutablePath": "C:\\\\x\\\\terminal64.exe"}')
        self.assertEqual(out, [{"pid": 42, "path": "C:\\x\\terminal64.exe", "cmd": None}])

    def test_list_and_query_fields(self):
        text = '[{"ProcessId": 7, "CommandLine": "python mt5_grid_hft.py"}]'
        self.assertEqual(gc.parse_process_json(text)[0]["pid"], 7)
        self.assertEqual(gc.parse_process_json(text)[0]["cmd"], "python mt5_grid_hft.py")
        self.assertEqual(gc.parse_process_json('[{"PID": "9"}]')[0]["pid"], 9)

    def test_empty_and_garbage(self):
        self.assertEqual(gc.parse_process_json(""), [])
        self.assertEqual(gc.parse_process_json("not json"), [])
        self.assertEqual(gc.parse_process_json("42"), [])


class RingBufferTests(unittest.TestCase):
    def test_since_and_cursor(self):
        buf = gc.RingBuffer(maxlen=5)
        buf.append("satu")
        buf.append("dua")
        self.assertEqual(buf.next_seq(), 2)
        lines = buf.since(0)
        self.assertEqual([line["text"] for line in lines], ["satu", "dua"])
        self.assertEqual(buf.since(2), [])

    def test_dropped(self):
        buf = gc.RingBuffer(maxlen=2)
        for text in ("a", "b", "c"):
            buf.append(text)
        self.assertEqual(buf.dropped(), 1)
        self.assertEqual(len(buf.since(0)), 2)


class BotControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import mt5_gui
        cls.gui = mt5_gui

    def wait_exit(self, bot, timeout=20.0):
        deadline = time.time() + timeout
        while bot.is_running() and time.time() < deadline:
            time.sleep(0.05)
        deadline = time.time() + 5.0
        while bot.snapshot()["exit_code"] is None and time.time() < deadline:
            time.sleep(0.05)

    def test_start_logs_and_exit(self):
        bot = self.gui.BotController()
        bot.start([sys.executable, "-u", "-c", "print('halo'); print('dunia')"])
        self.wait_exit(bot)
        texts = [line["text"] for line in bot.lines.since(0)]
        self.assertIn("halo", texts)
        self.assertIn("dunia", texts)
        self.assertEqual(bot.snapshot()["state"], "EXITED")

    def test_double_start_rejected_and_stop(self):
        bot = self.gui.BotController()
        bot.start([sys.executable, "-u", "-c", "import time; time.sleep(30)"])
        try:
            with self.assertRaises(self.gui.BusyError):
                bot.start([sys.executable, "-u", "-c", "print('x')"])
        finally:
            bot.stop(wait=3)
        self.wait_exit(bot, timeout=5)
        self.assertFalse(bot.is_running())


if __name__ == "__main__":
    unittest.main()
