import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "radar"))

import llm


class LLMConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Path(self.tmp.name) / "nested" / "llm.json"
        self.env = patch.dict(os.environ, {"RADAR_LLM_CONFIG": str(self.config)}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_save_masks_api_key_and_uses_private_permissions(self):
        result = llm.save_config(
            "openai_api", model="gpt-5-mini", api_key="sk-test-secret")
        self.assertNotIn("sk-test-secret", json.dumps(result))
        self.assertTrue(result["has_api_key"]["openai_api"])
        saved = json.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(saved["api_keys"]["openai_api"], "sk-test-secret")
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o600)

    def test_invalid_compatible_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "http"):
            llm.save_config("openai_compatible", model="m", base_url="file:///tmp/x",
                            api_key="secret")

    def test_private_compatible_target_requires_explicit_opt_in(self):
        private_dns = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch.object(llm.socket, "getaddrinfo", return_value=private_dns), \
             patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RADAR_ALLOW_PRIVATE_LLM_URL", None)
            with self.assertRaisesRegex(ValueError, "内网"):
                llm._validate_base_url("https://localhost:8443/v1")
        with patch.dict(os.environ, {"RADAR_ALLOW_PRIVATE_LLM_URL": "1"}, clear=False):
            self.assertEqual(llm._validate_base_url("http://127.0.0.1:11434/v1"),
                             "http://127.0.0.1:11434/v1")

    def test_json_parser_requires_object(self):
        self.assertEqual(llm._parse_output("```json\n{\"ok\": true}\n```", True),
                         {"ok": True})
        with self.assertRaisesRegex(ValueError, "顶层"):
            llm._parse_output("[1, 2]", True)

    def test_selected_provider_failure_never_falls_back(self):
        cfg = llm._deep_default({"provider": "codex_cli"})
        with patch.object(llm, "load_config", return_value=cfg), \
             patch.object(llm, "_ask_codex", side_effect=llm.LLMUnavailable("boom")), \
             patch.object(llm, "_ask_claude") as claude:
            with self.assertRaisesRegex(llm.LLMUnavailable, "boom"):
                llm.ask("test", expect_json=False)
            claude.assert_not_called()

    def test_environment_overrides_are_not_written_back(self):
        with patch.dict(os.environ, {"RADAR_LLM_PROVIDER": "codex_cli",
                                     "RADAR_LLM_MODEL": "temporary-model"}, clear=False):
            llm.save_config("claude_cli", model="saved-model")
        saved = json.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(saved["provider"], "claude_cli")
        self.assertEqual(saved["models"]["claude_cli"], "saved-model")
        self.assertNotIn("temporary-model", json.dumps(saved))

    def test_symlink_config_is_rejected(self):
        target = Path(self.tmp.name) / "target.json"
        target.write_text("{}", encoding="utf-8")
        target.chmod(0o600)
        self.config.parent.mkdir(parents=True)
        self.config.symlink_to(target)
        with self.assertRaisesRegex(llm.LLMUnavailable, "符号链接"):
            llm.load_config()


class CLISafetyTests(unittest.TestCase):
    def test_codex_prompt_uses_stdin_and_read_only_sandbox(self):
        seen = {}

        def fake_run(command, **kwargs):
            seen["command"] = command
            seen["input"] = kwargs.get("input_text")
            output = Path(command[command.index("-o") + 1])
            output.write_text('{"ok":true}', encoding="utf-8")
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(llm, "resolve_cli", return_value=("/fake/codex", "codex-cli 1")), \
             patch.object(llm, "_cli_auth", return_value=(True, "Logged in")), \
             patch.object(llm, "_run", side_effect=fake_run):
            raw = llm._ask_codex("private prompt", "", True)
        self.assertEqual(raw, '{"ok":true}')
        self.assertIn('"task": "private prompt"', seen["input"])
        self.assertEqual(seen["command"][-1], "-")
        self.assertIn("read-only", seen["command"])
        self.assertIn("--ephemeral", seen["command"])
        self.assertEqual(seen["command"][1:4], ["--ask-for-approval", "never", "exec"])
        disabled = {seen["command"][i + 1] for i, value in enumerate(seen["command"][:-1])
                    if value == "--disable"}
        self.assertTrue({"shell_tool", "unified_exec", "apps", "browser_use",
                         "computer_use", "plugins"}.issubset(disabled))
        self.assertIn('web_search="disabled"', seen["command"])
        self.assertNotIn("private prompt", seen["command"])

    def test_claude_has_no_tools_and_uses_stdin(self):
        seen = {}

        def fake_run(command, **kwargs):
            seen["command"] = command
            seen["input"] = kwargs.get("input_text")
            return subprocess.CompletedProcess(command, 0, "通了", "")

        with patch.object(llm, "resolve_cli", return_value=("/fake/claude", "Claude Code")), \
             patch.object(llm, "_run", side_effect=fake_run):
            raw = llm._ask_claude("private prompt", "", False)
        self.assertEqual(raw, "通了")
        self.assertIn('"task": "private prompt"', seen["input"])
        self.assertIn("--tools", seen["command"])
        self.assertIn("--no-session-persistence", seen["command"])
        self.assertIn("--strict-mcp-config", seen["command"])
        self.assertNotIn("private prompt", seen["command"])

    def test_cli_environment_excludes_application_secrets(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "secret", "MY_TOKEN": "token",
                                     "PATH": "/bin", "HOME": "/tmp/home"}, clear=False):
            env = llm._safe_cli_env("/tmp/work")
        self.assertEqual(env["PATH"], "/bin")
        self.assertEqual(env["TMPDIR"], "/tmp/work")
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("MY_TOKEN", env)

    def test_health_check_makes_real_request(self):
        cfg = llm._deep_default({"provider": "codex_cli"})
        with patch.object(llm, "load_config", return_value=cfg), \
             patch.object(llm, "_ask_with_config", return_value="RADAR_LLM_OK") as ask:
            ok, detail = llm.health_check()
        self.assertTrue(ok)
        self.assertIn("RADAR_LLM_OK", detail)
        ask.assert_called_once()

    def test_openai_error_redacts_key_and_closes_client(self):
        class FailingResponses:
            def create(self, **_kwargs):
                raise RuntimeError("request rejected for sk-private")

        class FakeClient:
            responses = FailingResponses()
            closed = False

            def close(self):
                self.closed = True

        client = FakeClient()
        cfg = llm._deep_default({"provider": "openai_api"})
        with patch.object(llm, "_openai_client", return_value=(client, "sk-private")):
            with self.assertRaises(llm.LLMUnavailable) as caught:
                llm._ask_openai("openai_api", "hello", "gpt-5-mini", cfg)
        self.assertNotIn("sk-private", str(caught.exception))
        self.assertIn("[REDACTED]", str(caught.exception))
        self.assertTrue(client.closed)

    def test_openai_sdk_protocols_return_text_and_close(self):
        class FakeResponses:
            def create(self, **kwargs):
                self.kwargs = kwargs
                return types.SimpleNamespace(output_text='{"official":true}')

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content='{"compatible":true}')
                return types.SimpleNamespace(choices=[types.SimpleNamespace(message=message)])

        class FakeClient:
            def __init__(self):
                self.responses = FakeResponses()
                self.chat = types.SimpleNamespace(completions=FakeCompletions())
                self.closed = False

            def close(self):
                self.closed = True

        official = FakeClient()
        cfg = llm._deep_default({"provider": "openai_api"})
        with patch.object(llm, "_openai_client", return_value=(official, "key")):
            text = llm._ask_openai("openai_api", "p", "gpt-5-mini", cfg)
        self.assertEqual(text, '{"official":true}')
        self.assertIn('"task": "p"', official.responses.kwargs["input"])
        self.assertTrue(official.closed)

        compatible = FakeClient()
        with patch.object(llm, "_openai_client", return_value=(compatible, "key")):
            text = llm._ask_openai("openai_compatible", "p", "model", cfg)
        self.assertEqual(text, '{"compatible":true}')
        content = compatible.chat.completions.kwargs["messages"][0]["content"]
        self.assertIn('"task": "p"', content)
        self.assertTrue(compatible.closed)


if __name__ == "__main__":
    unittest.main()
