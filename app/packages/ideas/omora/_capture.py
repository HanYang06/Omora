"""捕捉区的状态机：三个 Tile ↔ 工作区 ↔ 已保存条。

页面只问「现在长什么样」（`region`），入口动作交给它（`open`）。落库靠引擎
卸载捕捉组件时的那次提交：录完、录制中点「收起」、换页都是同一条路——所以这里
只在提交成功那一刻决定要不要把面板换成已保存条。

audio / video 由各自的插件按服务名提供，可能比 ideas 装得晚，所以每次现取。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Any

from omora.sdk.ui import (
    Audio,
    AudioCapture,
    Button,
    Handler,
    Input,
    Node,
    Panel,
    Row,
    Text,
    Tile,
)

from . import _views
from ._format import caption, clock, now, seconds

AUDIO = "audio"
VIDEO = "video"
TEXT = "text"
_TITLES = {AUDIO: "录音", VIDEO: "视频", TEXT: "文字"}


class Capture:
    """捕捉区：点 Tile 进工作区，提交成功之后出一条已保存条。"""

    def __init__(
        self,
        ideas: Any,
        audio: Callable[[], Any],
        video: Callable[[], Any],
    ) -> None:
        self._ideas = ideas
        self._audio = audio
        self._video = video
        self._state: dict[str, Any] = {}

    def clear(self) -> None:
        self._state.clear()

    def open(self, mode: str) -> Handler:
        """点 Tile：只换捕捉区，不换页面模式。"""

        def run(_: dict[str, Any]) -> None:
            self.clear()
            self._state.update(mode=mode, phase="live")

        return run

    def hold_start(self, _: dict[str, Any]) -> None:
        """按住空格：工作区直接进录音，引擎一挂上就开录。"""
        if self._audio() is None:
            return
        self.clear()
        self._state.update(mode=AUDIO, phase="live", autostart=True)

    def hold_end(self, _: dict[str, Any]) -> None:
        """松开：回三个 Tile；落库交给引擎卸载组件时的那次提交，不出命名条。"""
        self.clear()

    def region(self) -> Node:
        """捕捉区：没有工作区就是三个 Tile，有就把这一块换成工作区。"""
        if self._state:
            opened = self._workspace()
            if opened is not None:
                return opened
            self.clear()
        return Row(*self._tiles())

    def _workspace(self) -> Node | None:
        """工作区：一行头部（媒体名 + 收起）+ 主体；落库后是已保存条。"""
        mode = str(self._state.get("mode", ""))
        if self._state.get("phase") == "saved":
            parts: list[Node] = [Text(f"已保存 · {clock(seconds(self._state))}")]
            # 视频不给内联播放：16:9 全宽塞不进一条。
            if mode == AUDIO:
                parts.append(Audio(media=str(self._state.get("media", ""))))
            parts.append(Button("再录一条", on_click=self._again))
            parts.append(Button("收起", variant="ghost", on_click=self._collapse))
            return Panel(Row(*parts))
        body = self._body(mode)
        if body is None:
            return None
        return _views.workspace(_TITLES[mode], body, self._collapse)

    def _body(self, mode: str) -> Node | None:
        """工作区的主体：audio / video 插件给的捕捉节点，或一行文字输入。"""
        if mode == TEXT:
            return Input(placeholder="记一条灵感…", on_submit=self._save_text)
        if mode == AUDIO:
            service = self._audio()
            if service is None:
                return None
            node: AudioCapture | None = service.node(self._save_audio)
            if node is not None and self._state.get("autostart"):
                node = replace(node, autostart=True)
            return node
        service = self._video()
        return None if service is None else service.node(self._save_video)

    def _tiles(self) -> list[Node]:
        nodes: list[Node] = []
        # 没有媒体通道就出不了捕捉节点：挂了也存不下，别给一个点了会消失的 Tile。
        audio = self._audio()
        if audio is not None and audio.node(self._save_audio) is not None:
            nodes.append(Tile(icon="mic", title="录音", on_click=self.open(AUDIO)))
        video = self._video()
        if video is not None and video.node(self._save_video) is not None:
            nodes.append(Tile(icon="video", title="视频", on_click=self.open(VIDEO)))
        nodes.append(Tile(icon="text", title="文字", on_click=self.open(TEXT)))
        return nodes

    def _collapse(self, _: dict[str, Any]) -> None:
        self.clear()

    def _again(self, _: dict[str, Any]) -> None:
        """再录一条：回到录制初始态，重新挂上捕捉组件。"""
        mode = str(self._state.get("mode", ""))
        self.clear()
        self._state.update(mode=mode, phase="live")

    def _save_text(self, payload: dict[str, Any]) -> None:
        value = str(payload.get("value", "")).strip()
        if not value:
            return
        self._ideas.add(title=value, archived=False, pinned=False, media=None)
        self.clear()

    def _save_audio(self, payload: dict[str, Any]) -> None:
        service = self._audio()
        if service is None:
            return
        media_id = service.capture(payload)
        if not media_id:
            return
        self._settle(AUDIO, media_id, payload, caption(now(), "语音"))

    def _save_video(self, payload: dict[str, Any]) -> None:
        service = self._video()
        if service is None:
            return
        media_id = service.capture(payload)
        if not media_id:
            return
        self._settle(VIDEO, media_id, payload, caption(now(), "视频"))

    def _settle(self, mode: str, media_id: str, payload: dict[str, Any], title: str) -> None:
        """落库之后切到已保存条；面板早收起（或换了捕捉）就只落库。

        录制中 / 上传中点「收起」时组件是卸载掉的，引擎在卸载时提交；
        这时不能再把面板变回来。
        """
        self._ideas.add(title=title, archived=False, pinned=False, media=media_id)
        if self._state.get("mode") != mode or self._state.get("phase") != "live":
            return
        self.clear()
        self._state.update(mode=mode, phase="saved", media=media_id, seconds=seconds(payload))
