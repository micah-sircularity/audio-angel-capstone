import json

from audio_angel.paths import logs_dir
from audio_angel.telemetry import RunRecord, log_run


def test_log_run_appends_valid_jsonl():
    record = RunRecord(
        source_key="aud:x",
        title="Song",
        kind="music",
        rule_ids=["profanity", "term:x"],
        config={"model": "m", "name": "cfg-name"},
        n_segments=10,
        n_flags=2,
        n_raw_flags=3,
        latency_ms=1234,
        requests=2,
        input_tokens=100,
        output_tokens=20,
        tool_calls={"search_lexicon": 2},
    )
    row = log_run(record)
    row2 = log_run(record)
    lines = (logs_dir() / "runs.jsonl").read_text().splitlines()
    assert len(lines) == 2
    parsed = json.loads(lines[0])
    assert parsed["run_id"] == row["run_id"] != row2["run_id"]
    assert parsed["source_key"] == "aud:x"
    assert parsed["config"]["name"] == "cfg-name"
    assert parsed["tool_calls"] == {"search_lexicon": 2}
    assert parsed["error"] is None
    assert "ts" in parsed
