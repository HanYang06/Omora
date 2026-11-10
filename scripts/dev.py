"""dev：一条命令起开发环境（内核 + 渲染引擎）。

两个进程都要看得见，但各说各的没用：内核是日志的唯一写者，引擎的日志帧会
被内核收进来一起打；这里只负责把两条子进程输出拢到一个终端里，加前缀、
加颜色、传 OMORA_LOG，并在端口被占时马上说人话。

用法：
    uv run python scripts/dev.py            # 内核 + 引擎
    uv run python scripts/dev.py --kernel   # 只起内核（调协议用）
    uv run python scripts/dev.py --web      # 只起引擎（内核已在跑）
    uv run python scripts/dev.py -v         # OMORA_LOG=debug
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KERNEL_PORT = 8765
WEB_PORT = 5173
POLL_SECONDS = 0.3

RESET = "\x1b[0m"
DIM = "\x1b[2m"
KERNEL_COLOR = "\x1b[36m"
VITE_COLOR = "\x1b[35m"
WARN = "\x1b[33m"
BAD = "\x1b[31m"


def _pnpm(*args: str) -> list[str]:
    if sys.platform == "win32":
        return ["cmd", "/c", "pnpm", *args]
    return ["pnpm", *args]


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
        import signal

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


def _watch(processes: list[tuple[str, subprocess.Popen[bytes]]]) -> int:
    while True:
        for name, process in processes:
            code = process.poll()
            if code is not None:
                print(f"{BAD}{name}退出了（{code}），收掉其它。{RESET}", file=sys.stderr)
                return code if code != 0 else 1
        time.sleep(POLL_SECONDS)


def main() -> int:
    # 终端编码：子进程（vite / 日志）会吐非 GBK 字符，先统一成 UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Omora 开发环境")
    parser.add_argument("--kernel", action="store_true", help="只起内核")
    parser.add_argument("--web", action="store_true", help="只起引擎")
    parser.add_argument("-v", "--verbose", action="store_true", help="日志开到 debug")
    args = parser.parse_args()

    want_kernel = not args.web
    want_web = not args.kernel

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
        threads.append(threading.Thread(target=_pump, args=(kernel, "[kernel]", KERNEL_COLOR), daemon=True))

    if want_web:
        web = _spawn(
            _pnpm(
                "--dir", "app/ui-engine", "exec", "vite",
                "--host", "127.0.0.1", "--port", str(WEB_PORT), "--strictPort",
            ),
            env=env,
        )
        processes.append(("引擎", web))
        threads.append(threading.Thread(target=_pump, args=(web, "[vite]", VITE_COLOR), daemon=True))

    for thread in threads:
        thread.start()

    print(f"{DIM}日志文件：{ROOT / '.omora' / 'logs' / 'dev.jsonl'}{RESET}")
    if want_kernel:
        print(f"内核 {DIM}ws://127.0.0.1:{KERNEL_PORT}{RESET}")
    if want_web:
        print(f"引擎 {DIM}http://127.0.0.1:{WEB_PORT}{RESET}")
    print("Ctrl+C 一起停；-v 看 debug。", flush=True)

    try:
        return _watch(processes)
    except KeyboardInterrupt:
        print("\n收工。", flush=True)
        return 0
    finally:
        for _name, process in reversed(processes):
            _stop(process)


if __name__ == "__main__":
    raise SystemExit(main())
