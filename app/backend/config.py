import re
from pathlib import Path

DATA_ROOT = Path("/net/mraid20/ifs/wisdom/segal_lab/genie/LabData/Analyses/aradz_shared/loader/junk/claude_inspect")
CLAUDE_PROJECTS_ROOT = Path.home() / ".claude" / "projects"
DB_ROOT = Path(__file__).parent / "db"
INDEX_STATE_PATH = DB_ROOT / "session_index.json"
PROMPTS_ROOT = Path(__file__).parent / "prompts"
GENERATED_SESSIONS_ROOT = DB_ROOT / "generated_sessions"

MAX_JSONL_SCAN_LINES = 400
MAX_RECENT_SESSIONS = 20

SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
AGENT_ID_PATTERN = re.compile(r"^[a-f0-9]+$")

LOCAL_COMMAND_CAVEAT_PATTERN = re.compile(
    r"<local-command-caveat>[\s\S]*?</local-command-caveat>",
    re.IGNORECASE,
)
TASK_NOTIFICATION_PATTERN = re.compile(
    r"<task-notification>[\s\S]*?</task-notification>",
    re.IGNORECASE,
)
COMMAND_NAME_PATTERN = re.compile(
    r"<command-name>[\s\S]*?</command-name>",
    re.IGNORECASE,
)
LOCAL_COMMAND_STDOUT_PATTERN = re.compile(
    r"<local-command-stdout>[\s\S]*?</local-command-stdout>",
    re.IGNORECASE,
)
