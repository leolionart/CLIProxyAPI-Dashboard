# Codex Tracking Proposal (Mar 24, 2026)

> Update May 13, 2026: repo now includes an inferred Codex skill hook at
> `scripts/codex_skill_usage_hook.py`. It reuses `/api/collector/skill-events`
> with `source = codex-hook` and `trigger_type = inferred`. The cautions below
> still apply: this is not a first-class exact Codex skill event.

Ghi chú thiết kế ban đầu cho việc hỗ trợ tracking Codex trong CLIProxyDash.

Mục tiêu của tài liệu này là:

- Ghi lại kết quả research trước khi implement.
- Phân biệt rõ phần nào của Codex có thể track **chính xác** bằng interface chính thức.
- Chỉ ra phần nào hiện tại chỉ có thể track theo kiểu **best-effort / inferred**.
- Đề xuất hướng mở rộng dashboard mà không phá pipeline tracking của Claude đang chạy.

## 1) Kết luận ngắn

### 1.1 Có thể track chính xác

Codex hiện có interface chính thức đủ tốt để track chính xác cho:

- agent / sub-agent lifecycle
- turn lifecycle
- command execution
- file diff / plan updates
- token usage theo thread
- MCP tool calls / web search / item events

Hai surface đáng tin cậy nhất:

- `codex exec --json`
- `codex app-server`

### 1.2 Chưa thấy cách track skill chính xác như Claude

Tại thời điểm research này, tôi **không thấy** tài liệu chính thức của Codex mô tả:

- hook kiểu `PostToolUse` dành riêng cho `skill`
- event first-class kiểu `skill.started` / `skill.completed`
- payload chính thức dành riêng cho skill invocation

Vì vậy:

- tracking `Codex agent` là hướng khả thi và chính xác hơn
- tracking `Codex skill` hiện chỉ nên xem là best-effort, trừ khi OpenAI bổ sung hook/event chính thức trong tương lai

## 2) Nguồn chính thức đã kiểm tra

Research này dựa trên tài liệu OpenAI chính thức, kiểm tra ngày **March 24, 2026**:

- Codex non-interactive: https://developers.openai.com/codex/noninteractive
- Codex app server: https://developers.openai.com/codex/app-server
- Codex SDK: https://developers.openai.com/codex/sdk
- Codex config reference: https://developers.openai.com/codex/config-reference
- Codex config sample: https://developers.openai.com/codex/config-sample

## 3) Findings chi tiết

### 3.1 `codex exec --json`

Docs mô tả `--json` sẽ xuất JSONL và capture toàn bộ event mà Codex emit trong non-interactive mode.

Nhóm event được nêu trong docs gồm:

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `item.*`
- `error`

Docs cũng nói `item` có thể bao gồm:

- agent messages
- reasoning
- command executions
- file changes
- MCP tool calls
- web searches
- plan updates

Ý nghĩa cho dashboard:

- Đây là nguồn dữ liệu machine-readable tốt để ingest vào collector.
- Dùng được cho các workflow automation, CI, batch job, scripted tasks.
- Dữ liệu phù hợp để build timeline và metrics cho Codex run.

### 3.2 `codex app-server`

Docs mô tả `app-server` có stream notification/events rõ ràng hơn non-interactive mode.

Các nhóm event được public trong docs gồm:

- `thread/*`
- `turn/*`
- `item/*`
- `thread/tokenUsage/updated`
- `turn/plan/updated`
- `turn/diff/updated`

Docs còn cho thấy `thread/list` có thể filter theo `sourceKinds`, ví dụ:

- `subAgent`
- `subAgentReview`
- `subAgentCompact`
- `subAgentThreadSpawn`

Ý nghĩa cho dashboard:

- Đây là bằng chứng rõ nhất rằng Codex có khái niệm sub-agent ở API/event layer.
- Có thể track khá chính xác số agent được spawn, thời điểm spawn, lifecycle của thread/turn, usage, diff, plan.
- Nếu muốn tracking “agents” thật sự, `app-server` là nền tảng tốt nhất.

### 3.3 Codex SDK

Docs nói SDK là surface “more comprehensive and flexible” hơn non-interactive mode.

Tuy nhiên, ở mức docs public đã kiểm tra, schema event không được mô tả cụ thể bằng `app-server`.

Ý nghĩa:

- SDK có thể là đường triển khai tốt trong tương lai.
- Nhưng nếu cần contract event rõ ràng ngay bây giờ, `app-server` và `exec --json` vẫn là 2 điểm bám chắc hơn.

### 3.4 Codex config / observability

Từ config docs, các cơ chế liên quan observability gồm:

- `history.persistence = save-all`
- `log_dir`
- `notify`
- OTEL exporters như `otel.exporter`, `otel.trace_exporter`

Ý nghĩa:

- Có thể dùng để thu transcript/log/trace.
- Hữu ích cho audit và best-effort analytics.
- Nhưng docs không cho thấy event first-class dành riêng cho `skill`.

## 4) So sánh với pipeline Claude hiện tại

Pipeline hiện tại của dự án track Claude skill theo mô hình:

- client hook
- gửi `POST /api/collector/skill-events`
- lưu vào `skill_runs`
- aggregate sang `skill_daily_stats`
- render trên tab Skills

Điểm mạnh của Claude path:

- có hook rõ cho `Skill`
- identity của run tương đối ổn định
- semantics bám sát đúng “skill invocation”

Điểm khác với Codex:

- Codex docs hiện không cho thấy hook skill tương đương
- Codex public surface lại mạnh hơn ở mức thread/turn/agent/item event

Kết luận:

- Không nên ép Codex vào đúng shape “Claude skill tracker” nếu mục tiêu là chính xác.
- Với Codex, entity trung tâm nên là `agent run` hoặc `thread/turn run`, không phải `skill run`.

## 5) Đề xuất product direction

### 5.1 Ưu tiên support `Codex agent` trước

Lý do:

- Có event surface chính thức rõ hơn.
- Semantics phù hợp với Codex hơn.
- Độ chính xác cao hơn so với cố suy luận skill invocation.

### 5.2 Chỉ support `Codex skill` dưới dạng inferred nếu thật sự cần

Nếu sau này cần hiển thị “skill-like usage” cho Codex, nên ghi rõ đây là dữ liệu suy luận từ:

- transcript
- item events
- command patterns
- prompt / metadata conventions

Không nên gọi đây là “exact tracking” nếu không có hook chính thức.

Implementation hiện tại:

- Stop hook script: `scripts/codex_skill_usage_hook.py`
- Collector endpoint tái sử dụng: `/api/collector/skill-events`
- Marker để lọc: `source = codex-hook`
- Evidence hiện có: đọc file `*/skills/<skill>/SKILL.md` hoặc assistant message thông báo dùng skill
- Không thêm bảng mới; dashboard Skills hiện tại đọc được các row này ngay

## 6) Đề xuất data model mức cao

Không implement ở giai đoạn này. Đây chỉ là shape đề xuất.

### 6.1 Giữ nguyên bảng Claude hiện có

Không đổi semantic của:

- `skill_runs`
- `skill_daily_stats`

Lý do:

- tránh phá compatibility với Claude plugin hiện tại
- tránh làm UI hiện tại bị lẫn khái niệm

### 6.2 Thêm pipeline riêng cho Codex agent

Đề xuất:

- endpoint mới: `/api/collector/codex-agent-events`
- bảng mới: `codex_agent_runs`
- aggregate mới: `codex_agent_daily_stats`

Field gợi ý cho `codex_agent_runs`:

- `event_uid`
- `provider` = `codex`
- `thread_id`
- `turn_id`
- `agent_id` nếu event surface có identity này
- `parent_thread_id` hoặc `parent_agent_id` nếu suy ra được
- `source_kind`
- `status`
- `started_at`
- `completed_at`
- `duration_ms`
- `input_tokens`
- `output_tokens`
- `reasoning_tokens` nếu có
- `cached_tokens` nếu có
- `command_count`
- `tool_call_count`
- `web_search_count`
- `mcp_call_count`
- `file_change_count`
- `model`
- `reasoning_effort`
- `machine_id`
- `project_dir`
- `raw_event_type`
- `raw_payload`

### 6.3 Nếu muốn thống nhất UI đa-provider

Có thể thêm tầng view/model chung thay vì nhét tất cả vào một bảng:

- `activity_runs`
- `activity_daily_stats`

Trong đó:

- `provider`: `claude` | `codex`
- `kind`: `skill` | `agent`

Nhưng đây là bước sau. Không nên làm ngay nếu chưa rõ product UX.

## 7) Đề xuất ingestion modes

### 7.1 Exact mode

Áp dụng khi team chạy Codex qua:

- `codex exec --json`
- `codex app-server`

Đặc điểm:

- ingest event chính thức
- lifecycle rõ ràng
- accuracy cao
- phù hợp production analytics

### 7.2 Best-effort mode

Áp dụng khi team chỉ dùng Codex CLI interactive thông thường.

Nguồn có thể cân nhắc:

- `history.jsonl`
- `log_dir`
- OTEL traces/logs
- `notify`

Đặc điểm:

- một phần dữ liệu phải suy luận
- dễ lệch semantic
- không nên gắn nhãn là exact

## 8) Đề xuất rollout theo phase

### Phase 0 — Research complete

Done trong tài liệu này:

- xác nhận bề mặt chính thức của Codex
- xác nhận chưa thấy hook skill first-class
- xác định nên ưu tiên agent tracking

### Phase 1 — Instrumentation proposal

Việc cần làm ở phase này:

- chốt ingestion source đầu tiên: `app-server` hay `exec --json`
- chốt event contract tối thiểu
- chốt identity strategy cho run / thread / turn / sub-agent

### Phase 2 — Storage design

Việc cần làm:

- thiết kế schema riêng cho Codex agent
- thiết kế aggregate daily stats
- xác định index/idempotency keys

### Phase 3 — Dashboard UX

Các option:

- tab riêng `Codex Agents`
- tab chung `Skills & Agents`
- tab activity với filter `provider` + `kind`

### Phase 4 — Optional inferred skill analytics

Chỉ làm nếu có nhu cầu thực sự.

Điều kiện:

- chấp nhận semantics không hoàn toàn chính xác
- UI gắn nhãn rõ là inferred / estimated

## 9) Open questions

Những câu hỏi cần trả lời trước khi implement:

- Team sẽ track Codex từ local interactive usage hay từ automation?
- Có quyền kiểm soát cách Codex được launch không?
- Có chấp nhận chạy thêm `app-server` hoặc wrapper cho `codex exec` không?
- Dashboard có cần đồng nhất Claude + Codex trong cùng một tab không?
- Có cần tracking tới mức thread/turn/item hay chỉ cần daily aggregate?

## 10) Recommendation

Khuyến nghị hiện tại:

1. Không implement “Codex skill tracking” theo style Claude ngay lúc này.
2. Nếu support Codex, hãy bắt đầu bằng `Codex agent tracking`.
3. Chọn một ingestion path chính thức:
   - ưu tiên `codex app-server` nếu cần realtime / lifecycle đầy đủ
   - ưu tiên `codex exec --json` nếu cần đơn giản và batch-friendly
4. Chỉ coi `skill-like analytics` là phase sau, và gắn nhãn inferred nếu không có hook chính thức.

## 11) Note cho lần research tiếp theo

Khi revisit tài liệu OpenAI trong tương lai, cần kiểm tra lại xem Codex có thêm các tính năng sau chưa:

- hook chính thức cho skill/tool lifecycle
- event schema public đầy đủ cho SDK
- metadata rõ ràng hơn cho sub-agent identity
- callback/webhook chính thức cho local interactive CLI
