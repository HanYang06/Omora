"""开发环境：内核 + 渲染引擎 + 可选桌面壳。

两个进程各写各的日志会互相看不见：内核是日志的唯一写者，引擎的日志帧由内核
收下一起落盘上屏。这里只负责把子进程输出拢到一个终端，加前缀和颜色，传
OMORA_LOG，并在端口被占时直接给出处理命令。

用法：
    omora dev                # 内核 + 引擎
    omora dev --kernel       # 只起内核（调协议用）
    omora dev --web          # 只起引擎（内核已在跑）
    omora dev --shell        # 再起桌面壳（Electron）
    omora dev -v             # OMORA_LOG=debug
"""

from __future__ import annotations

import argparse
import contextlib
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, cast

ROOT = Path(__file__).resolve().parents[4]
KERNEL_PORT = 8765
WEB_PORT = 5173
POLL_SECONDS = 0.3

RESET = "\x1b[0m"
DIM = "\x1b[2m"
KERNEL_COLOR = "\x1b[36m"
VITE_COLOR = "\x1b[35m"
SHELL_COLOR = "\x1b[34m"
WARN = "\x1b[33m"
BAD = "\x1b[31m"


def _pnpm(*args: str) -> list[str]:
    if sys.platform == "win32":
        return ["cmd", "/c", "pnpm", *args]
    return ["pnpm", *args]


def _electron() -> Path | None:
    """桌面壳的可执行文件；没装就返回 None，别把整条启动链拖死。"""
    base = ROOT / "app" / "shell" / "node_modules" / "electron" / "dist"
    exe = base / ("electron.exe" if sys.platform == "win32" else "electron")
    return exe if exe.exists() else None


def _busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return True
    return False


def _explain_busy(port: int, what: str) -> None:
    print(
        f"{BAD}{what}要的端口 {port} 已被占用。{RESET}",
        file=sys.stderr,
    )
    print(
        f"  先看一眼是谁：{DIM}netstat -ano | findstr :{port}{RESET}\n"
        f"  再收掉它：{DIM}taskkill /PID <pid> /T /F{RESET}",
        file=sys.stderr,
    )


def _spawn(argv: list[str], *, env: dict[str, str] | None = None) -> subprocess.Popen[bytes]:
    """各自开一个进程组，收的时候整棵收；输出走管道，好加前缀。"""
    if sys.platform == "win32":
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return subprocess.Popen(
            argv,
            cwd=ROOT,
            creationflags=flags,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    return subprocess.Popen(
        argv,
        cwd=ROOT,
        start_new_session=True,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def _pump(process: subprocess.Popen[bytes], prefix: str, color: str) -> None:
    """一个子进程一行一行读，加前缀打到同一个终端。"""
    stream = process.stdout
    if stream is None:
        return
    for raw in iter(stream.readline, b""):
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        if line:
            print(f"{color}{prefix}{RESET} {line}", flush=True)
    stream.close()


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
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=5)


def _watch(processes: list[tuple[str, subprocess.Popen[bytes]]]) -> int:
    while True:
        for name, process in processes:
            code = process.poll()
            if code is not None:
                print(
                    f"{BAD}{name} 退出（code={code}），其余进程一并停止。{RESET}", file=sys.stderr
                )
                return code if code != 0 else 1
        time.sleep(POLL_SECONDS)


def main(argv: list[str] | None = None) -> int:  # noqa: PLR0912, PLR0915 —— CLI 编排
    # 终端编码：子进程（vite / 日志）会吐非 GBK 字符，先统一成 UTF-8
    cast(Any, sys.stdout).reconfigure(encoding="utf-8", errors="replace")
    cast(Any, sys.stderr).reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Omora 开发环境")
    parser.add_argument("--kernel", action="store_true", help="只起内核")
    parser.add_argument("--web", action="store_true", help="只起引擎")
    parser.add_argument("--shell", action="store_true", help="再起桌面壳（Electron）")
    parser.add_argument("--devtools", action="store_true", help="壳里自动打开 DevTools")
    parser.add_argument("-v", "--verbose", action="store_true", help="日志开到 debug")
    args = parser.parse_args(argv)

    want_kernel = not args.web
    want_web = not args.kernel or args.shell
    want_shell = args.shell

    # 壳能不能起，先查：这一步失败必须发生在起进程之前，否则内核和 vite 会被留在后台。
    shell_exe = _electron() if want_shell else None
    if want_shell and shell_exe is None:
        print(f"{BAD}壳还没装：先跑 pnpm install{RESET}", file=sys.stderr)
        return 2

    if want_kernel and _busy(KERNEL_PORT):
        _explain_busy(KERNEL_PORT, "内核")
        return 2
    if want_web and _busy(WEB_PORT):
        _explain_busy(WEB_PORT, "引擎")
        return 2

    env = {
        **os.environ,
        "OMORA_DEV": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",
        "PYTHONUNBUFFERED": "1",
    }
    if args.verbose:
        env["OMORA_LOG"] = "debug"

    processes: list[tuple[str, subprocess.Popen[bytes]]] = []
    threads: list[threading.Thread] = []

    if want_kernel:
        kernel = _spawn([sys.executable, str(ROOT / "app" / "main.py")], env=env)
        processes.append(("内核", kernel))
        threads.append(
            threading.Thread(target=_pump, args=(kernel, "[kernel]", KERNEL_COLOR), daemon=True)
        )

    if want_web:
        web = _spawn(
            _pnpm(
                "--dir",
                "app/ui-engine",
                "exec",
                "vite",
                "--host",
                "127.0.0.1",
                "--port",
                str(WEB_PORT),
                "--strictPort",
            ),
            env=env,
        )
        processes.append(("引擎", web))
        threads.append(
            threading.Thread(target=_pump, args=(web, "[vite]", VITE_COLOR), daemon=True)
        )

    if want_shell and shell_exe is not None:
        shell_env = {
            **env,
            "OMORA_DEV_URL": f"http://127.0.0.1:{WEB_PORT}",
            "OMORA_DEVTOOLS": "1" if args.devtools else "0",
        }
        # 某些编辑器 / CI 会设这个：它让 electron.exe 退化成 node，壳直接起不来
        shell_env.pop("ELECTRON_RUN_AS_NODE", None)
        shell = _spawn([str(shell_exe), str(ROOT / "app" / "shell")], env=shell_env)
        processes.append(("壳", shell))
        threads.append(
            threading.Thread(target=_pump, args=(shell, "[shell]", SHELL_COLOR), daemon=True)
        )

    for thread in threads:
        thread.start()

    print(f"{DIM}日志文件：{ROOT / '.omora' / 'logs' / 'dev.jsonl'}{RESET}")
    if want_kernel:
        print(f"内核 {DIM}ws://127.0.0.1:{KERNEL_PORT}{RESET}")
    if want_web:
        print(f"引擎 {DIM}http://127.0.0.1:{WEB_PORT}{RESET}")
    if want_shell:
        print("壳：Electron 窗口（--devtools 自动开 DevTools）")
    print("Ctrl+C 停止全部进程。", flush=True)

    try:
        return _watch(processes)
    except KeyboardInterrupt:
        print("\n已停止。", flush=True)
        return 0
    finally:
        for _name, process in reversed(processes):
            _stop(process)


if __name__ == "__main__":
    raise SystemExit(main())
