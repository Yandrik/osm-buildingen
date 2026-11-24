import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    "update_publish", Path(__file__).resolve().parents[1] / "update_publish.py"
)
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)

MANIFEST = {
    "base": "/paris-ride/",
    "dataVersion": "a" * 20,
    "terrainBytes": 100,
    "terrainChunkBytes": 16,
}


class PublishTests(unittest.TestCase):
    def test_app_build_uses_live_manifest_without_staging_data(self):
        with patch.object(publisher.subprocess, "run") as run:
            publisher.build_site(Path("/unused/site"), MANIFEST, False)
        command = run.call_args.args[0]
        self.assertIn("vite", command)
        self.assertNotIn("prepare-site.ts", " ".join(command))
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["VITE_SIM_DATA_URL"], f"data/{'a' * 20}/")
        self.assertEqual(env["VITE_SIM_TERRAIN_BYTES"], "100")

    def test_data_build_invokes_existing_runtime_stager(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "deployment.json").write_text(json.dumps(MANIFEST))
            with patch.object(publisher.subprocess, "run") as run:
                actual = publisher.build_site(output, None, True)
        self.assertEqual(actual, MANIFEST)
        self.assertIn("scripts/prepare-site.ts", run.call_args.args[0])

    def test_manifest_rejects_wrong_base_unsafe_snapshot_and_missing_sizes(self):
        for edit in (
            {"base": "/other/"},
            {"dataVersion": "../secret"},
            {"terrainBytes": 0},
            {"terrainChunkBytes": True},
        ):
            with self.subTest(edit=edit):
                with self.assertRaises(ValueError):
                    publisher.validate_manifest({**MANIFEST, **edit})

    def publish_fixture(self, root, also_data=False):
        (root / "assets").mkdir()
        (root / "assets/app.js").write_text("app")
        (root / "index.html").write_text("index")
        if also_data:
            (root / "data/snapshot").mkdir(parents=True)
            (root / "data/snapshot/chunk.bin").write_bytes(b"terrain")
            (root / "deployment.json").write_text(json.dumps(MANIFEST))
        cli = Mock()
        client = Mock()
        remote = {}
        order = []

        def upload(_client, path, data, _type):
            remote[path] = data
            order.append(path)

        cli.upload.side_effect = upload
        client.request.side_effect = lambda _method, _endpoint, path: (remote[path], {})
        return cli, client, order

    def test_app_only_uploads_no_data_or_manifest_and_html_is_last(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli, client, order = self.publish_fixture(root)
            with patch.object(publisher, "read_manifest", return_value=MANIFEST):
                publisher.publish(cli, client, root, MANIFEST, MANIFEST, False, 1)
        self.assertEqual(order, ["paris-ride/assets/app.js", "paris-ride/index.html"])

    def test_also_data_publishes_data_and_manifest_before_html(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli, client, order = self.publish_fixture(root, True)
            with patch.object(publisher, "read_manifest", return_value=MANIFEST):
                publisher.publish(cli, client, root, MANIFEST, MANIFEST, True, 1)
        self.assertIn("paris-ride/data/snapshot/chunk.bin", order[:-2])
        self.assertEqual(order[-2:], ["paris-ride/deployment.json", "paris-ride/index.html"])

    def test_unexpected_data_is_refused_in_app_only_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli, client, _ = self.publish_fixture(root, True)
            with patch.object(publisher, "read_manifest", return_value=MANIFEST):
                with self.assertRaisesRegex(ValueError, "Refusing to upload data"):
                    publisher.publish(cli, client, root, MANIFEST, MANIFEST, False, 1)
            cli.upload.assert_not_called()

    def test_changed_manifest_aborts_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli, client, _ = self.publish_fixture(root)
            with patch.object(publisher, "read_manifest", return_value={**MANIFEST, "terrainBytes": 200}):
                with self.assertRaisesRegex(ValueError, "changed during the build"):
                    publisher.publish(cli, client, root, MANIFEST, MANIFEST, False, 1)
            cli.upload.assert_not_called()

    def test_asset_verification_failure_never_switches_html(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli, client, order = self.publish_fixture(root)
            client.request.side_effect = lambda *_args: (b"wrong bytes", {})
            with patch.object(publisher, "read_manifest", return_value=MANIFEST):
                with self.assertRaisesRegex(ValueError, "Published bytes differ"):
                    publisher.publish(cli, client, root, MANIFEST, MANIFEST, False, 1)
            self.assertNotIn("paris-ride/index.html", order)


if __name__ == "__main__":
    unittest.main()
