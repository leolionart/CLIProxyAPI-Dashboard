import { useState } from 'react'

const collectorUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain'}/api/collector/skill-events`

const HOOK_SCRIPT = `#!/usr/bin/env python3
"""
CLIProxy Skill Tracker — Claude Code PostToolUse hook.
Sends skill usage events to your CLIProxy Dashboard.
Stdlib only. Always exits 0.
"""
import json, os, socket, sys, urllib.request
from datetime import datetime, timezone
from pathlib import PurePosixPath

URL = os.environ.get('CLIPROXY_COLLECTOR_URL', '${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain'}/api/collector/skill-events')

def main():
    try:
        p = json.loads(sys.stdin.read() or '{}')
    except Exception:
        return
    ti = (p.get('tool_input') or {}) if isinstance(p, dict) else {}
    skill = str(ti.get('skill') or '').strip()
    sid = str(p.get('session_id') or '').strip()
    if not skill or not sid:
        return
    cwd = str(p.get('cwd') or '').strip()
    evt = {
        'machine_id': socket.gethostname(),
        'skill_name': skill,
        'session_id': sid,
        'trigger_type': 'explicit',
        'triggered_at': datetime.now(timezone.utc).isoformat(),
        'arguments': ti.get('args'),
        'is_skeleton': False,
        'project_dir': PurePosixPath(cwd).name if cwd else '',
    }
    try:
        data = json.dumps({'events': [evt]}).encode()
        req = urllib.request.Request(URL, data=data, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass`

const SETTINGS_JSON = (scriptPath) => `{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \\"${scriptPath}\\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}`

const CODEX_INSTALL_COMMANDS = `mkdir -p ~/.codex/hooks
curl -fsSL \\
  https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/scripts/codex_skill_usage_hook.py \\
  -o ~/.codex/hooks/codex_skill_usage_hook.py
chmod +x ~/.codex/hooks/codex_skill_usage_hook.py`

const CODEX_ONE_STEP_SETUP = `curl -fsSL \\
  https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/scripts/setup_codex_tracking.py \\
  | python3 - --collector-url "${collectorUrl}"`

const CODEX_HOOKS_JSON = `{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \\"$HOME/.codex/hooks/codex_skill_usage_hook.py\\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}`

const CODEX_CONFIG_TOML = `[features]
codex_hooks = true`

const CODEX_DRY_RUN = `CLIPROXY_DRY_RUN=1 python3 ~/.codex/hooks/codex_skill_usage_hook.py <<'JSON'
{"session_path":"$HOME/.codex/sessions/YYYY/MM/DD/rollout-...jsonl"}
JSON`

function CopyButton({ text }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
        } catch {
            setCopied(false)
        }
    }

    return (
        <button
            className={`guide-copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            title={copied ? 'Copied' : 'Copy'}
            aria-label={copied ? 'Copied' : 'Copy'}
        >
            {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
            )}
        </button>
    )
}

function CodeBlock({ code, isDarkMode, language }) {
    return (
        <div className="guide-code-wrap">
            <CopyButton text={code} />
            {language && <span className="guide-code-lang">{language}</span>}
            <pre className="guide-code"><code>{code}</code></pre>
        </div>
    )
}

function SetupGuide({ isDarkMode }) {
    const [showManual, setShowManual] = useState(false)
    const [showCodexManual, setShowCodexManual] = useState(false)
    const [activeStack, setActiveStack] = useState('claude')
    const scriptPath = '~/.claude/hooks/track-skills.py'

    return (
        <div className="help-panel">
            {/* ── Overview ── */}
            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Skill Tracking Setup</h3>
                    </div>
                    <div className="chart-body">
                        <p className="guide-intro">
                            Choose the agent stack you want to connect. Claude Code uses the marketplace plugin path;
                            Codex CLI uses the Stop hook installer. Both write to the shared <strong>Agent Skills</strong> dashboard.
                        </p>
                        <div className="chart-tabs" style={{ marginBottom: 16 }}>
                            <button className={`tab ${activeStack === 'claude' ? 'active' : ''}`} onClick={() => setActiveStack('claude')}>
                                Claude Code
                            </button>
                            <button className={`tab ${activeStack === 'codex' ? 'active' : ''}`} onClick={() => setActiveStack('codex')}>
                                Codex CLI
                            </button>
                            <button className={`tab ${activeStack === 'api' ? 'active' : ''}`} onClick={() => setActiveStack('api')}>
                                Manual API
                            </button>
                        </div>
                        <div className="guide-flow">
                            <div className="guide-flow-step">
                                <span className="guide-flow-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                                </span>
                                <span>Agent uses a skill</span>
                            </div>
                            <span className="guide-flow-arrow">→</span>
                            <div className="guide-flow-step">
                                <span className="guide-flow-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                </span>
                                <span>Hook sends event</span>
                            </div>
                            <span className="guide-flow-arrow">→</span>
                            <div className="guide-flow-step">
                                <span className="guide-flow-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                                </span>
                                <span>Dashboard displays</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Claude Stack ── */}
            {activeStack === 'claude' && <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Claude Code stack</h3>
                    </div>
                    <div className="chart-body">
                        <p className="guide-desc">
                            Run these commands inside Claude Code to add the marketplace and install the tracker plugin.
                            This registers hooks automatically — no manual config needed.
                        </p>
                        <div className="guide-tip" style={{ marginBottom: 12 }}>
                            Tracker distribution now comes from the shared <code>claude-skills</code> marketplace repository.
                        </div>
                        <CodeBlock isDarkMode={isDarkMode} language="claude" code={`/plugin marketplace add leolionart/claude-skills`} />
                        <CodeBlock isDarkMode={isDarkMode} language="claude" code={`/plugin install claude-skill-tracker`} />
                        <p className="guide-desc" style={{ fontWeight: 600, marginTop: 18 }}>Dashboard endpoint</p>
                        <CodeBlock isDarkMode={isDarkMode} language="bash" code={`export CLIPROXY_COLLECTOR_URL="${collectorUrl}"`} />
                        <div className="guide-tip">
                            <strong>Local setup?</strong> If your dashboard runs on the same machine
                            at <code>localhost:8417</code>, this step is optional — that's the default URL.
                        </div>
                        <div className="guide-tip" style={{ marginTop: 10 }}>
                            <strong>Important dedupe note:</strong> if you already installed <code>claude-skill-tracker</code> from marketplace,
                            do <strong>not</strong> keep a manual <code>PostToolUse: Skill</code> hook at the same time. Running both can send duplicate events.
                        </div>
                        <p className="guide-desc" style={{ fontWeight: 600, marginTop: 18 }}>Verify</p>
                        <p className="guide-desc">
                            Restart Claude Code (<code>/exit</code> then reopen), invoke any skill (e.g. type <code>/commit</code>),
                            then check <strong>Agent Skills</strong>. Your run should appear within seconds.
                        </p>
                        <p className="guide-desc">Or test the endpoint directly with curl:</p>
                        <CodeBlock
                            isDarkMode={isDarkMode}
                            language="bash"
                            code={`curl -X POST ${collectorUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"events": [{"skill_name": "test", "session_id": "manual-test"}]}'`}
                        />
                        <p className="guide-desc" style={{ marginTop: 12 }}>
                            Expected response: <code>{`{"status":"ok","upserted":1,"skipped":0}`}</code>
                        </p>
                        <p className="guide-desc" style={{ marginTop: 8 }}>
                            Dedupe checklist: one skill invocation should map to one unique <code>event_uid</code>.
                            If counts look doubled, remove duplicate manual/plugin hooks and test again.
                        </p>
                        <div className="guide-tip">
                            <strong>What the plugin tracks:</strong> skill name, session ID, project directory,
                            input/output tokens, tool call count, duration, and model — all parsed automatically
                            from Claude's transcript.
                        </div>
                    </div>
                </div>
            </div>}

            {/* ── Codex Setup ── */}
            {activeStack === 'codex' && <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Codex CLI stack</h3>
                    </div>
                    <div className="chart-body">
                        <p className="guide-desc">
                            Install the Codex Stop hook on each machine that should report inferred skill usage.
                            The hook reads local Codex session JSONL files and sends final rows with <code>source=codex-hook</code>.
                        </p>

                        <p className="guide-desc" style={{ fontWeight: 600 }}>One-step setup</p>
                        <CodeBlock isDarkMode={isDarkMode} language="bash" code={CODEX_ONE_STEP_SETUP} />
                        <div className="guide-tip">
                            This installer downloads the hook, creates a wrapper with this dashboard URL, enables Codex hooks,
                            and appends the Stop hook without removing existing hooks.
                        </div>

                        <p className="guide-desc" style={{ marginTop: 10 }}>
                            Then run a normal Codex session that uses a skill and check <strong>Agent Skills</strong>.
                            The dashboard separates machines by <code>machine_id</code>.
                        </p>

                        <div className="guide-tip" style={{ marginTop: 14 }}>
                            <strong>Current Codex coverage:</strong> skill usage is inferred from local session evidence,
                            such as reading a <code>SKILL.md</code> file or an assistant message that announces a skill.
                            Codex sub-agent / agent lifecycle is not collected by this Stop hook yet; that needs a separate
                            Codex agent event pipeline, endpoint, and schema.
                        </div>

                        <div style={{ marginTop: 16, border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`, borderRadius: 8 }}>
                            <div
                                className="chart-header"
                                style={{ cursor: 'pointer', padding: '12px 16px' }}
                                onClick={() => setShowCodexManual(!showCodexManual)}
                            >
                                <h3 style={{ color: isDarkMode ? 'var(--color-text-secondary)' : '#64748b', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                                        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                        style={{ transition: 'transform 0.2s', transform: showCodexManual ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                    >
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                    Manual Setup (without one-step installer)
                                </h3>
                            </div>
                            {showCodexManual && (
                                <div className="chart-body">
                                    <p className="guide-desc" style={{ fontWeight: 600 }}>1. Install the hook script</p>
                                    <CodeBlock isDarkMode={isDarkMode} language="bash" code={CODEX_INSTALL_COMMANDS} />

                                    <p className="guide-desc" style={{ fontWeight: 600, marginTop: 18 }}>2. Point it at this dashboard</p>
                                    <CodeBlock isDarkMode={isDarkMode} language="bash" code={`export CLIPROXY_COLLECTOR_URL="${collectorUrl}"`} />
                                    <div className="guide-tip">
                                        Put this export in <code>~/.zshrc</code>, <code>~/.bashrc</code>, or the environment used to launch Codex on that machine.
                                    </div>

                                    <p className="guide-desc" style={{ fontWeight: 600, marginTop: 18 }}>3. Enable Codex hooks</p>
                                    <p className="guide-desc">
                                        Add or keep this setting in <code>~/.codex/config.toml</code>:
                                    </p>
                                    <CodeBlock isDarkMode={isDarkMode} language="toml" code={CODEX_CONFIG_TOML} />

                                    <p className="guide-desc" style={{ fontWeight: 600, marginTop: 18 }}>4. Register the Stop hook</p>
                                    <p className="guide-desc">
                                        Add the command below to <code>~/.codex/hooks.json</code>. If the file already has Stop hooks,
                                        append this command instead of replacing the existing hooks.
                                    </p>
                                    <CodeBlock isDarkMode={isDarkMode} language="json" code={CODEX_HOOKS_JSON} />

                                    <p className="guide-desc" style={{ fontWeight: 600, marginTop: 18 }}>5. Test locally</p>
                                    <CodeBlock isDarkMode={isDarkMode} language="bash" code={CODEX_DRY_RUN} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>}

            {/* ── Manual Alternative (collapsible) ── */}
            {activeStack === 'claude' && <div className="charts-row">
                <div className="chart-card chart-full" style={{ border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}` }}>
                    <div
                        className="chart-header"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setShowManual(!showManual)}
                    >
                        <h3 style={{ color: isDarkMode ? 'var(--color-text-secondary)' : '#64748b', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg
                                xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                style={{ transition: 'transform 0.2s', transform: showManual ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            >
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                            Manual Setup (without plugin)
                        </h3>
                    </div>
                    {showManual && (
                        <div className="chart-body">
                            <p className="guide-desc" style={{ marginBottom: 16 }}>
                                If you can't install plugins, you can set up tracking manually with a Python script.
                                This method sends skill name, session, and project but does <strong>not</strong> include token/duration metrics.
                            </p>

                            <p className="guide-desc" style={{ fontWeight: 600 }}>1. Save the hook script</p>
                            <CodeBlock isDarkMode={isDarkMode} language="bash" code={`mkdir -p ~/.claude/hooks`} />
                            <p className="guide-desc" style={{ marginTop: 8 }}>
                                Save as <code>{scriptPath}</code>:
                            </p>
                            <CodeBlock isDarkMode={isDarkMode} language="python" code={HOOK_SCRIPT} />
                            <CodeBlock isDarkMode={isDarkMode} language="bash" code={`chmod +x ${scriptPath}`} />

                            <p className="guide-desc" style={{ fontWeight: 600, marginTop: 20 }}>2. Register in Claude settings</p>
                            <p className="guide-desc">
                                Add this to <code>~/.claude/settings.json</code>:
                            </p>
                            <CodeBlock isDarkMode={isDarkMode} language="json" code={SETTINGS_JSON(scriptPath)} />

                            <div className="guide-tip" style={{ marginTop: 16 }}>
                                <strong>Remote server?</strong> Change the URL in the script, or set <code>CLIPROXY_COLLECTOR_URL</code> in your shell profile.
                            </div>
                        </div>
                    )}
                </div>
            </div>}

            {/* ── API Reference ── */}
            {activeStack === 'api' && <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>API Reference</h3>
                    </div>
                    <div className="chart-body">
                        <div className="help-grid">
                            <div className="help-tile">
                                <div className="help-tile-label">Endpoint</div>
                                <div className="help-url">{collectorUrl}</div>
                                <div className="help-note">POST with <code>Content-Type: application/json</code></div>
                            </div>
                        </div>
                        <p className="guide-desc" style={{ marginTop: 16 }}>Request body:</p>
                        <CodeBlock isDarkMode={isDarkMode} language="json" code={`{
  "events": [
    {
      "skill_name": "commit",       // required
      "session_id": "abc-123",      // required
      "machine_id": "my-laptop",    // optional, default: ""
      "project_dir": "my-app",      // optional, project folder name
      "trigger_type": "explicit",   // optional
      "triggered_at": "2025-...",   // optional, ISO 8601
      "arguments": "--amend",       // optional
      "tokens_used": 1200,          // optional, input tokens
      "output_tokens": 800,         // optional
      "tool_calls": 5,              // optional
      "duration_ms": 3200,          // optional
      "model": "opus",              // optional
      "is_skeleton": false          // optional, true = dry-run/preview
    }
  ]
}`} />
                        <div className="guide-fields-grid">
                            <div className="guide-field">
                                <code>skill_name</code>
                                <span className="help-badge required">required</span>
                                <span>Skill identifier, e.g. "commit", "simplify"</span>
                            </div>
                            <div className="guide-field">
                                <code>session_id</code>
                                <span className="help-badge required">required</span>
                                <span>Claude session or conversation ID</span>
                            </div>
                            <div className="guide-field">
                                <code>machine_id</code>
                                <span className="help-badge optional">optional</span>
                                <span>Hostname to separate stats per machine</span>
                            </div>
                            <div className="guide-field">
                                <code>project_dir</code>
                                <span className="help-badge optional">optional</span>
                                <span>Project folder name (auto-detected from <code>cwd</code> by the plugin)</span>
                            </div>
                            <div className="guide-field">
                                <code>is_skeleton</code>
                                <span className="help-badge optional">optional</span>
                                <span>Set <code>true</code> for preview/dry-run events (excluded from daily stats)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>}
        </div>
    )
}

export default SetupGuide
