"""Judge tests run the real Fireworks model — re-enable model requests
for this package only (the root conftest disables them globally)."""

import pydantic_ai.models
import pytest


@pytest.fixture(autouse=True)
def _allow_model_requests():
    pydantic_ai.models.ALLOW_MODEL_REQUESTS = True
    yield
    pydantic_ai.models.ALLOW_MODEL_REQUESTS = False
