import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "radar"))

from fastapi import HTTPException, Request, Response

import api


class LLMSettingsAPITests(unittest.TestCase):
    @staticmethod
    def request(headers=None, client="198.51.100.20", scheme="https", method="GET"):
        raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        return Request({"type": "http", "headers": raw,
                        "client": (client, 1234),
                        "server": ("example.test", 443), "scheme": scheme,
                        "method": method, "path": "/", "query_string": b""})

    def test_remote_style_request_requires_configured_token(self):
        fake = {"provider": "claude_cli", "model": "", "models": {},
                "base_url": "", "has_api_key": {}}
        with patch.dict(os.environ, {"RADAR_SETTINGS_TOKEN": "correct"}, clear=False), \
             patch.object(api, "public_config", return_value=fake), \
             patch.object(api, "provider_statuses", return_value=[]):
            with self.assertRaises(HTTPException) as denied:
                api.llm_providers(self.request(), Response())
            response = Response()
            allowed = api.llm_providers(
                self.request({"X-Radar-Settings-Token": "correct"}), response)
        self.assertEqual(denied.exception.status_code, 401)
        self.assertEqual(allowed["providers"], [])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_provider_api_contract_is_registered(self):
        paths = api.app.openapi()["paths"]
        self.assertIn("get", paths["/api/llm/providers"])
        self.assertIn("post", paths["/api/llm/providers/scan"])
        self.assertIn("post", paths["/api/llm/providers/test"])
        self.assertIn("get", paths["/api/llm/config"])
        self.assertIn("put", paths["/api/llm/config"])
        self.assertIn("post", paths["/api/llm/health"])

    def test_local_mode_rejects_cross_site_browser_requests(self):
        same_origin = self.request({
            "Host": "127.0.0.1:8000",
            "Origin": "http://127.0.0.1:8000",
            "Sec-Fetch-Site": "same-origin",
        }, client="127.0.0.1", scheme="http", method="POST")
        cross_site = self.request({
            "Host": "127.0.0.1:8000",
            "Origin": "https://evil.example",
            "Sec-Fetch-Site": "cross-site",
        }, client="127.0.0.1", scheme="http", method="POST")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RADAR_SETTINGS_TOKEN", None)
            api.require_settings_access(same_origin)
            with self.assertRaises(HTTPException) as denied:
                api.require_settings_access(cross_site)
        self.assertEqual(denied.exception.status_code, 403)

    def test_test_endpoint_does_not_save_config(self):
        with patch.dict(os.environ, {"RADAR_SETTINGS_TOKEN": "correct"}, clear=False), \
             patch.object(api, "test_provider", return_value=(True, "通了")) as test:
            response = api.test_llm_connection(
                api.LLMTestInput(provider="openai_api", model="gpt-5-mini",
                                 api_key="temporary-secret"),
                self.request({"Authorization": "Bearer correct"}), Response())
        self.assertTrue(response["ok"])
        self.assertEqual(response["detail"], "通了")
        self.assertEqual(response["message"], "连接成功")
        self.assertEqual(test.call_args.kwargs["api_key"], "temporary-secret")


if __name__ == "__main__":
    unittest.main()
