#!/usr/bin/env python3
"""
Best-effort Codex skill usage hook for CLIProxyDash.

Codex does not currently emit a first-class "skill used" event like Claude's
Skill tool. This hook runs at Stop, reads the Codex session JSONL, infers skill
usage from concrete evidence, and forwards final events to the existing
/api/collector/skill-events endpoint.

Evidence supported:
  - command arguments that read a */skills/<name>/SKILL.md file
  - assistant messages that explicitly announce a skill was used

The script is dependency-free and always exits 0 so it never blocks Codex.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import socket
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional


COLLECTOR_URL = os.environ.get(
    "CLIPROXY_COLLECTOR_URL",
    "http://localhost:5001/api/collector/skill-events",
)
CODEX_HOME = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
MACHINE_ID = socket.gethostname()


SKILL_MD_RE = re.compile(
    r"(?P<path>(?:~|/|\.{1,2}/)?[^\s'\"`]*?(?:skills|plugins)/[^\s'\"`]*?/SKILL\.md)"
)
SKILL_SEGMENT_RE = re.compile(r"(?:^|/)(?:skills|\.codex/skills|\.agent/skills|\.agents/skills|\.claude/skills)/(?P<skill>[^/]+)/SKILL\.md$")
ANNOUNCE_RE = re.compile(
    r"(?:using|use|dùng|sử dụng)\s+(?:the\s+)?skill(?:s)?\s*(?:[:\-]\s*)?(?P<names>[A-Za-z0-9_.:/@,+\-\s`]+)",
    re.IGNORECASE,
)
CODE_SPAN_RE = re.compile(r"`([^`]+)`")
FILE_READ_COMMAND_RE = re.compile(r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=.*\s+)*(?:cat|sed|nl|head|tail|less|more|bat)\b")


def _read_stdin_json() -> Dict[str, Any]:
    try:
        raw = sys.stdin.read()
    except Exception:
        return {}
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value or 0)
    except Exception:
        return default


def _safe_iso(value: Any) -> str:
    raw = str(value or "").strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    if raw:
        try:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception:
            pass
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except Exception:
        return str(value)


def _hash_int(value: str) -> int:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 2147483647


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if isinstance(obj, dict):
                    entries.append(obj)
    except Exception:
        return []
    return entries


def _find_session_path(payload: Dict[str, Any]) -> Optional[Path]:
    for key in ("transcript_path", "session_path", "rollout_path", "conversation_path", "path"):
        raw = str(payload.get(key) or "").strip()
        if raw and Path(raw).expanduser().is_file():
            return Path(raw).expanduser()

    session_id = str(payload.get("session_id") or payload.get("thread_id") or "").strip()
    if session_id:
        matches = list(CODEX_HOME.glob(f"sessions/**/rollout-*{session_id}*.jsonl"))
        if matches:
            return max(matches, key=lambda p: p.stat().st_mtime)

    candidates = [Path(p) for p in glob.glob(str(CODEX_HOME / "sessions" / "**" / "*.jsonl"), recursive=True)]
    if not candidates:
        return None

    cwd = str(payload.get("cwd") or "").strip()
    if cwd:
        recent = sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)[:50]
        for candidate in recent:
            meta = _first_session_meta(_load_jsonl(candidate))
            if str(meta.get("cwd") or "") == cwd:
                return candidate

    return max(candidates, key=lambda p: p.stat().st_mtime)


def _first_session_meta(entries: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    for entry in entries:
        if entry.get("type") == "session_meta" and isinstance(entry.get("payload"), dict):
            return entry["payload"]
    return {}


def _extract_text_from_message_payload(payload: Dict[str, Any]) -> str:
    chunks: List[str] = []
    content = payload.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                text = block.get("text") or block.get("input_text") or block.get("output_text")
                if isinstance(text, str):
                    chunks.append(text)
            elif isinstance(block, str):
                chunks.append(block)
    elif isinstance(content, str):
        chunks.append(content)
    return "\n".join(chunks)


def _normalize_skill_name(name: str) -> Optional[str]:
    cleaned = name.strip().strip("`'\".,;:()[]{}")
    if not cleaned:
        return None
    if "/" in cleaned and cleaned.endswith("SKILL.md"):
        return _skill_name_from_path(cleaned)
    if "/" in cleaned or "." in cleaned:
        return None
    if not re.match(r"^[A-Za-z0-9_:@\-]+$", cleaned):
        return None
    if cleaned.lower() in {"skill", "skills", "the", "and", "va", "và"}:
        return None
    return cleaned


def _skill_name_from_path(raw_path: str) -> Optional[str]:
    if any(ch in raw_path for ch in "[]()"):
        return None
    expanded = raw_path.replace("\\ ", " ").strip()
    if expanded.startswith("~"):
        expanded = str(Path(expanded).expanduser())
    normalized = str(PurePosixPath(expanded))

    match = SKILL_SEGMENT_RE.search(normalized)
    if match:
        return _normalize_skill_name(match.group("skill"))

    parts = [p for p in normalized.split("/") if p]
    if len(parts) >= 2 and parts[-1] == "SKILL.md":
        return _normalize_skill_name(parts[-2])
    return None


def _extract_skill_paths(text: str) -> List[str]:
    paths = []
    for match in SKILL_MD_RE.finditer(text):
        path = match.group("path")
        if path:
            paths.append(path)
    return paths


def _extract_announced_skills(text: str) -> List[str]:
    skills: List[str] = []
    for match in ANNOUNCE_RE.finditer(text):
        names = match.group("names") or ""
        names = re.split(r"\bhelper\b|\bartifact\b|\boutput\b", names, flags=re.IGNORECASE)[0]
        spans = CODE_SPAN_RE.findall(names)
        tokens = spans if spans else re.split(r"[,/&]|\band\b|\bvà\b", names, flags=re.IGNORECASE)
        for token in tokens:
            skill = _normalize_skill_name(token)
            if skill:
                skills.append(skill)
    return skills


def _latest_token_usage(entries: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    latest: Dict[str, int] = {}
    for entry in entries:
        payload = entry.get("payload") if isinstance(entry.get("payload"), dict) else {}
        if payload.get("type") != "token_count":
            continue
        info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
        usage = info.get("total_token_usage") if isinstance(info.get("total_token_usage"), dict) else {}
        if usage:
            latest = {
                "input_tokens": _to_int(usage.get("input_tokens")),
                "output_tokens": _to_int(usage.get("output_tokens")),
                "reasoning_output_tokens": _to_int(usage.get("reasoning_output_tokens")),
                "total_tokens": _to_int(usage.get("total_tokens")),
            }
    return latest


def _extract_skill_evidence(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for index, entry in enumerate(entries):
        ts = entry.get("timestamp")
        payload = entry.get("payload") if isinstance(entry.get("payload"), dict) else {}
        entry_type = entry.get("type")

        if entry_type == "response_item" and payload.get("type") == "function_call" and payload.get("name") == "exec_command":
            arg_text = str(payload.get("arguments") or "")
            try:
                args_obj = json.loads(arg_text)
            except Exception:
                args_obj = {}
            cmd = str(args_obj.get("cmd") or args_obj.get("command") or "").strip()
            if not FILE_READ_COMMAND_RE.search(cmd):
                continue
            search_text = cmd + "\n" + str(args_obj.get("workdir") or "")
            for path in _extract_skill_paths(search_text):
                skill = _skill_name_from_path(path)
                if not skill:
                    continue
                if skill in seen:
                    continue
                seen.add(skill)
                evidence.append({
                    "skill_name": skill,
                    "timestamp": ts,
                    "line_index": index,
                    "evidence_type": "skill_file_read",
                    "evidence": path,
                    "call_id": payload.get("call_id"),
                })

        if entry_type == "response_item" and payload.get("type") == "message" and payload.get("role") == "assistant":
            text = _extract_text_from_message_payload(payload)
            for skill in _extract_announced_skills(text):
                if skill in seen:
                    continue
                seen.add(skill)
                evidence.append({
                    "skill_name": skill,
                    "timestamp": ts,
                    "line_index": index,
                    "evidence_type": "assistant_announcement",
                    "evidence": text[:500],
                    "call_id": None,
                })

    return evidence


def _make_event(
    *,
    session_path: Path,
    session_meta: Dict[str, Any],
    evidence: Dict[str, Any],
    token_usage: Dict[str, int],
    occurrence_no: int,
) -> Dict[str, Any]:
    session_id = str(session_meta.get("id") or session_path.stem).strip()
    cwd = str(session_meta.get("cwd") or "").strip()
    project_dir = PurePosixPath(cwd).name if cwd else ""
    skill_name = evidence["skill_name"]
    tool_use_id = f"codex:{session_id}:{evidence.get('line_index', occurrence_no)}"
    event_uid_basis = "|".join([
        MACHINE_ID,
        session_id,
        skill_name,
        tool_use_id,
        str(occurrence_no),
    ])

    return {
        "event_uid": hashlib.sha1(event_uid_basis.encode("utf-8")).hexdigest(),
        "tool_use_id": tool_use_id,
        "machine_id": MACHINE_ID,
        "source": "codex-hook",
        "sqlite_id": _hash_int(event_uid_basis),
        "skill_name": skill_name,
        "session_id": session_id,
        "trigger_type": "inferred",
        "triggered_at": _safe_iso(evidence.get("timestamp") or session_meta.get("timestamp")),
        "status": "success",
        "attempt_no": occurrence_no,
        "arguments": json.dumps({
            "provider": "codex",
            "session_path": str(session_path),
            "evidence_type": evidence.get("evidence_type"),
            "evidence": evidence.get("evidence"),
        }, ensure_ascii=False),
        "tokens_used": token_usage.get("input_tokens", 0),
        "output_tokens": token_usage.get("output_tokens", 0),
        "tool_calls": 0,
        "duration_ms": 0,
        "model": str(session_meta.get("model") or "").strip() or None,
        "is_skeleton": False,
        "project_dir": project_dir,
    }


def _post_events(events: List[Dict[str, Any]]) -> None:
    if os.environ.get("CLIPROXY_DRY_RUN"):
        print(json.dumps({"events": events}, ensure_ascii=False, indent=2))
        return

    if not events:
        return

    try:
        data = json.dumps({"events": events}).encode("utf-8")
        req = urllib.request.Request(
            COLLECTOR_URL,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "CLIProxyDash-CodexSkillHook/1.0",
            },
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass


def main() -> None:
    payload = _read_stdin_json()
    session_path = _find_session_path(payload)
    if not session_path:
        return

    entries = _load_jsonl(session_path)
    if not entries:
        return

    session_meta = _first_session_meta(entries)
    evidence = _extract_skill_evidence(entries)
    if not evidence:
        return

    token_usage = _latest_token_usage(entries)
    events = [
        _make_event(
            session_path=session_path,
            session_meta=session_meta,
            evidence=item,
            token_usage=token_usage,
            occurrence_no=index + 1,
        )
        for index, item in enumerate(evidence)
    ]
    _post_events(events)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
