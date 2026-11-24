#!/usr/bin/env python3
"""Rebuild and publish Paris Ride, reusing live data unless --also-data is set."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import tempfile

APP = Path(__file__).resolve().parent
REMOTE = "paris-ride"
BASE = f"/{REMOTE}/"
DEFAULT_CLI = (
    Path.home()
    / ".config/opencode/skills/filebrowser-publish/scripts/filebrowser_cli.py"
)


def load_cli(path):
    spec = importlib.util.spec_from_file_location("filebrowser_cli", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"Cannot load File Browser CLI: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_manifest(manifest):
    if not isinstance(manifest, dict):
        raise ValueError("Deployment manifest must be an object")
    if manifest.get("base") != BASE:
        raise ValueError(f"Deployment base must be {BASE}")
    if not re.fullmatch(r"[a-f0-9]{20}", str(manifest.get("dataVersion", ""))):
        raise ValueError("Invalid data snapshot ID")
    for key in ("terrainBytes", "terrainChunkBytes"):
        value = manifest.get(key)
        if type(value) is not int or value <= 0:
            raise ValueError(f"Invalid {key} in deployment manifest")
    return manifest


def read_manifest(cli, client, allow_missing=False):
    try:
        body, _ = client.request("GET", "raw", f"{REMOTE}/deployment.json")
    except cli.CliError as error:
        if allow_missing and "HTTP 404 " in str(error):
            return None
        raise
    return validate_manifest(json.loads(body))


def build_environment(manifest):
    return {
        **os.environ,
        "VITE_SIM_DATA_URL": f"data/{manifest['dataVersion']}/",
        "VITE_SIM_DATA_GZIP": "true",
        "VITE_SIM_DATA_IMMUTABLE": "true",
        "VITE_SIM_TERRAIN_CHUNK_BYTES": str(manifest["terrainChunkBytes"]),
        "VITE_SIM_TERRAIN_BYTES": str(manifest["terrainBytes"]),
    }


def build_site(output, manifest, also_data):
    if also_data:
        subprocess.run(
            ["pnpm", "exec", "tsx", "scripts/prepare-site.ts", str(output), BASE],
            cwd=APP,
            check=True,
        )
        return validate_manifest(json.loads((output / "deployment.json").read_text()))
    # App-only updates never scan or copy data/, and don't overwrite a shared dist/.
    subprocess.run(
        [
            "pnpm", "exec", "vite", "build", "--base", BASE,
            "--outDir", str(output), "--emptyOutDir",
        ],
        cwd=APP,
        env=build_environment(manifest),
        check=True,
    )
    return manifest


def upload_one(cli, client, root, path):
    relative = path.relative_to(root).as_posix()
    data = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    # Retrying an exact path is safe; data is immutable and assets have hashed names.
    for attempt in range(3):
        try:
            cli.upload(client, f"{REMOTE}/{relative}", data, content_type)
            return relative
        except (cli.CliError, OSError):
            if attempt == 2:
                raise


def verify_one(client, root, relative):
    actual, _ = client.request("GET", "raw", f"{REMOTE}/{relative}")
    if actual != (root / relative).read_bytes():
        raise ValueError(f"Published bytes differ for {relative}")


def publish(cli, client, output, previous, manifest, also_data, workers):
    if read_manifest(cli, client, allow_missing=also_data) != previous:
        raise ValueError("Live data manifest changed during the build; rerun to use the latest")
    files = sorted(path for path in output.rglob("*") if path.is_file())
    if not (output / "index.html").is_file():
        raise ValueError("Build has no index.html")
    if not also_data and any(path.relative_to(output).parts[0] == "data" for path in files):
        raise ValueError("Refusing to upload data during an app-only update")
    pending = [
        path for path in files
        if path not in (output / "index.html", output / "deployment.json")
    ]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for count, _ in enumerate(
            pool.map(lambda path: upload_one(cli, client, output, path), pending), 1
        ):
            if count % 100 == 0:
                print(f"Uploaded {count}/{len(pending)} files", flush=True)
    # Verify every app asset before switching the entry point. Data is uploaded first
    # too; older immutable snapshots and hashed assets are never deleted.
    for path in pending:
        relative = path.relative_to(output).as_posix()
        if not relative.startswith("data/"):
            verify_one(client, output, relative)
    if read_manifest(cli, client, allow_missing=also_data) != previous:
        raise ValueError("Live data manifest changed during upload; entry point was not changed")
    if also_data:
        upload_one(cli, client, output, output / "deployment.json")
        verify_one(client, output, "deployment.json")
    upload_one(cli, client, output, output / "index.html")
    verify_one(client, output, "index.html")
    print(
        f"Published {len(pending) + 1 + int(also_data)} files: "
        f"{client.public(f'{REMOTE}/')}\n"
        f"Data snapshot: {manifest['dataVersion']} "
        f"({'uploaded' if also_data else 'unchanged; no data uploaded'})",
        flush=True,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--also-data", action="store_true", help="stage and upload runtime data too")
    parser.add_argument(
        "--filebrowser-cli", type=Path,
        default=Path(os.environ.get("FILEBROWSER_CLI", str(DEFAULT_CLI))),
        help="path to the publisher skill's filebrowser_cli.py (or FILEBROWSER_CLI)",
    )
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    args = parser.parse_args(argv)
    try:
        cli = load_cli(args.filebrowser_cli)
        # Authentication stays entirely in the skill CLI; never copy secrets here.
        client = cli.Client(cli.build_parser().parse_args(["list"]))
        client.ensure_token()
        previous = read_manifest(cli, client, allow_missing=args.also_data)
        temp_root = Path("/tmp/opencode")
        temp_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="paris-ride-publish-", dir=temp_root) as directory:
            output = Path(directory) / "site"
            manifest = build_site(output, previous, args.also_data)
            publish(cli, client, output, previous, manifest, args.also_data, args.workers)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Publish failed: {error}\n")
    except Exception as error:
        # CLI errors can include URLs but never request headers or credentials.
        parser.exit(1, f"Publish failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
