#!/usr/bin/env python3
"""
One-step installer for CLIProxyDash Codex skill tracking.

Installs the Stop hook script under ~/.codex/hooks, writes a small wrapper that
sets CLIPROXY_COLLECTOR_URL, enables Codex hooks in ~/.codex/config.toml, and
adds the wrapper to ~/.codex/hooks.json without removing existing hooks.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict


DEFAULT_HOOK_URL = (
    "https://raw.githubusercontent.com/leolionart/"
    "CLIProxyAPI-Dashboard/main/scripts/codex_skill_usage_hook.py"
)


def _chmod_exec(path: Path) -> None:
    mode = path.stat().st_mode if path.exists() else 0o644
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except Exception as exc:
        backup = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup)
        raise SystemExit(f"Invalid JSON in {path}. Backup created at {backup}: {exc}")


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    tmp.replace(path)


def _install_hook_script(destination: Path, source: str | None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source:
        src = Path(source).expanduser()
        if not src.is_file():
            raise SystemExit(f"Hook source not found: {src}")
        shutil.copy2(src, destination)
    else:
        with urllib.request.urlopen(DEFAULT_HOOK_URL, timeout=20) as response:
            destination.write_bytes(response.read())
    _chmod_exec(destination)


def _write_wrapper(wrapper_path: Path, hook_path: Path, collector_url: str) -> None:
    wrapper_path.parent.mkdir(parents=True, exist_ok=True)
    wrapper = f"""#!/usr/bin/env sh
export CLIPROXY_COLLECTOR_URL="{collector_url}"
exec python3 "{hook_path}" "$@"
"""
    wrapper_path.write_text(wrapper, encoding="utf-8")
    _chmod_exec(wrapper_path)


def _enable_codex_hooks(config_path: Path) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    lines = text.splitlines()

    features_start = None
    features_end = len(lines)
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "[features]":
            features_start = idx
            continue
        if features_start is not None and idx > features_start and stripped.startswith("[") and stripped.endswith("]"):
            features_end = idx
            break

    if features_start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(["[features]", "codex_hooks = true"])
    else:
        found = False
        for idx in range(features_start + 1, features_end):
            if lines[idx].strip().startswith("codex_hooks"):
                lines[idx] = "codex_hooks = true"
                found = True
                break
        if not found:
            lines.insert(features_end, "codex_hooks = true")

    config_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _install_stop_hook(hooks_path: Path, wrapper_path: Path, timeout: int) -> bool:
    data = _load_json(hooks_path)
    hooks = data.setdefault("hooks", {})
    stop_hooks = hooks.setdefault("Stop", [])
    if not isinstance(stop_hooks, list):
        raise SystemExit(f"Expected hooks.Stop to be a list in {hooks_path}")

    command = f'python3 "{wrapper_path}"'
    hook_entry = {
        "type": "command",
        "command": command,
        "timeout": timeout,
    }

    for group in stop_hooks:
        if not isinstance(group, dict):
            continue
        for existing in group.get("hooks", []) or []:
            if isinstance(existing, dict) and existing.get("command") == command:
                return False

    if stop_hooks and isinstance(stop_hooks[0], dict):
        group = stop_hooks[0]
        group_hooks = group.setdefault("hooks", [])
        if not isinstance(group_hooks, list):
            raise SystemExit(f"Expected first Stop hook group to contain a hooks list in {hooks_path}")
        group_hooks.append(hook_entry)
    else:
        stop_hooks.append({"hooks": [hook_entry]})

    _write_json(hooks_path, data)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Install CLIProxyDash Codex skill tracking hook.")
    parser.add_argument(
        "--collector-url",
        default=os.environ.get("CLIPROXY_COLLECTOR_URL"),
        help="Full /api/collector/skill-events URL. Defaults to CLIPROXY_COLLECTOR_URL.",
    )
    parser.add_argument(
        "--codex-home",
        default=os.environ.get("CODEX_HOME") or str(Path.home() / ".codex"),
        help="Codex home directory. Default: ~/.codex",
    )
    parser.add_argument(
        "--hook-source",
        default=None,
        help="Local codex_skill_usage_hook.py to install. Defaults to GitHub raw main.",
    )
    parser.add_argument("--timeout", type=int, default=10, help="Stop hook timeout in seconds.")
    args = parser.parse_args()

    if not args.collector_url:
        raise SystemExit("Missing --collector-url or CLIPROXY_COLLECTOR_URL.")

    codex_home = Path(args.codex_home).expanduser()
    hook_path = codex_home / "hooks" / "codex_skill_usage_hook.py"
    wrapper_path = codex_home / "hooks" / "codex_skill_usage_hook.sh"
    config_path = codex_home / "config.toml"
    hooks_path = codex_home / "hooks.json"

    _install_hook_script(hook_path, args.hook_source)
    _write_wrapper(wrapper_path, hook_path, args.collector_url)
    _enable_codex_hooks(config_path)
    added = _install_stop_hook(hooks_path, wrapper_path, args.timeout)

    print(f"Installed hook script: {hook_path}")
    print(f"Installed hook wrapper: {wrapper_path}")
    print(f"Enabled codex_hooks in: {config_path}")
    print(f"{'Added' if added else 'Already present'} Stop hook in: {hooks_path}")
    print("Restart Codex, run a session that uses a skill, then check Agent Skills.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
