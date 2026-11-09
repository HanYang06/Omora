"""dev：一条命令起开发环境（内核 + 渲染引擎）。

两个都是子进程，各自开一个进程组；Ctrl+C 或任一退出时一起收掉。
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POLL_SECONDS = 0.3


def _pnpm(*args: str) -> list[str]:
    if sys.platform == "win32":
        return ["cmd", "/c", "pnpm", *args]
    return ["pnpm", *args]


def _spawn(argv: list[str], cwd: Path) -> subprocess.Popen[bytes]:
    """各自开一个进程组，收的时候整棵收。"""
    if sys.platform == "win32":
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return subprocess.Popen(argv, cwd=cwd, creationflags=flags)
    return subprocess.Popen(argv, cwd=cwd, start_new_session=True)


def _stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            capture_output=True,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def _watch(kernel: subprocess.Popen[bytes], web: subprocess.Popen[bytes]) -> int:
    while True:
        for name, process in (("内核", kernel), ("引擎", web)):
            code = process.poll()
            if code is not None:
                print(f"{name}退出了（{code}），收掉另一个。", file=sys.stderr)
                return code if code != 0 else 1
        time.sleep(POLL_SECONDS)


def main() -> int:
    kernel = _spawn([sys.executable, str(ROOT / "app" / "main.py")], ROOT)
    web = _spawn(
        _pnpm(
            "--dir",
            "app/ui-engine",
            "exec",
            "vite",
            "--host",
            "127.0.0.1",
            "--port",
            "5173",
            "--strictPort",
        ),
        ROOT,
    )
    print("开发环境：内核 ws://127.0.0.1:8765 ；引擎 http://127.0.0.1:5173", flush=True)
    print("Ctrl+C 一起停。", flush=True)
    try:
        return _watch(kernel, web)
    except KeyboardInterrupt:
        print("\n收工。", flush=True)
        return 0
    finally:
        _stop(web)
        _stop(kernel)


if __name__ == "__main__":
    raise SystemExit(main())
