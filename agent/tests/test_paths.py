"""Regression: the default data dir is agent/data, not the repo root."""


def test_default_data_dir_is_agent_data(monkeypatch):
    monkeypatch.delenv("AUDIO_ANGEL_DATA_DIR", raising=False)
    from audio_angel.helpers.paths import data_dir

    assert data_dir().name == "data"
    assert (data_dir() / "..").resolve().name == "agent"
