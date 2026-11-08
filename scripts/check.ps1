# 门禁：一条命令跑完。任何一项失败就停。
$ErrorActionPreference = "Stop"

uv run pytest -q
uv run ruff check .
uv run mypy app
pnpm --dir app/ui-engine test --run
pnpm --dir app/ui-engine build
