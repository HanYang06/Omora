"""命令名、事件名与状态取值:插件内部与界面共用的常量。"""

from __future__ import annotations

PLUGIN_ID = "omora.requirements"
MAIN_CONTRIBUTION_ID = "requirements.main"
CREATE_COMMAND = "requirements.create"
SET_STATUS_COMMAND = "requirements.setStatus"
LIST_QUERY = "requirements.list"
PROJECT_LOOKUP_SERVICE = "projects.lookup"
FOCUSED_EVENT = "projects.focused"
CREATED_EVENT = "requirements.created"
STATUS_CHANGED_EVENT = "requirements.statusChanged"
REMOVE_COMMAND = "requirements.remove"
REMOVED_EVENT = "requirements.removed"

STATUS_TODO = "todo"
STATUS_DOING = "doing"
STATUS_DONE = "done"
STATUSES = frozenset({STATUS_TODO, STATUS_DOING, STATUS_DONE})
