.PHONY: help install app test test-judge lint format eval eval-smoke eval-tune eval-retrieval eval-feedback feedback-to-gt manual-sheet manual-summary docker-build up down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install deps with uv (incl. dev group)
	uv sync

app: ## Run the Streamlit app
	uv run streamlit run app/streamlit_app.py

test: ## Unit tests (offline; judge tests deselected)
	uv run pytest -q

test-judge: ## Live LLM judge tests (needs FIREWORKS_API_KEY)
	uv run pytest -q -m judge

lint: ## Ruff check + format check
	uv run ruff check . && uv run ruff format --check .

format: ## Ruff format + autofix
	uv run ruff format . && uv run ruff check --fix .

eval: ## Flagging eval on human-labeled ground truth
	uv run python evals/run_eval.py

eval-smoke: ## Flagging eval smoke (2 cases)
	uv run python evals/run_eval.py --limit 2

eval-tune: ## Tuning grid over prompt/chunk/retriever/threshold
	uv run python evals/tune.py

eval-retrieval: ## Lexicon retrieval eval (hit@k, MRR)
	uv run python evals/retrieval_eval.py

eval-feedback: ## Flagging eval on feedback-derived ground truth
	uv run python evals/run_eval.py --dataset feedback

feedback-to-gt: ## feedback.jsonl -> ground_truth_feedback/
	uv run python evals/feedback_to_gt.py

manual-sheet: ## Write reports/manual_eval_sheet.csv
	uv run python evals/manual_eval.py sheet

manual-summary: ## Summarize filled manual sheet -> reports/manual_eval.md
	uv run python evals/manual_eval.py summary

docker-build: ## Build the Docker image
	docker build -t audio-angel-agent .

up: ## docker compose up
	docker compose up -d

down: ## docker compose down
	docker compose down
