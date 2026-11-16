# Prosper Challenge — run everything from the repo root.
# Dependencies are managed with uv (https://docs.astral.sh/uv/).

PROJECT := backend

.PHONY: help install run api ui test test-api test-ui build clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Install backend and frontend dependencies from their lockfiles
	uv sync --directory $(PROJECT)
	npm ci --prefix frontend

run: api ## Run the API and voice server

api: ## Run API + WebRTC on http://127.0.0.1:8000
	uv run --directory $(PROJECT) python bot.py --host 127.0.0.1 --port 8000 -t webrtc

ui: ## Run the editor on http://127.0.0.1:5173
	npm run dev --prefix frontend

test: test-api test-ui ## Run backend checks and the browser happy path

test-api: ## Test graph validation, compilation, and file-backed agents
	uv run --directory $(PROJECT) pytest tests -q

test-ui: ## Run the browser happy path using isolated agent files
	npm test --prefix frontend

build: ## Typecheck and build the frontend
	npm run build --prefix frontend

clean: ## Remove the venv and Python caches
	rm -rf $(PROJECT)/.venv
	find $(PROJECT) -type d -name __pycache__ -prune -exec rm -rf {} +
