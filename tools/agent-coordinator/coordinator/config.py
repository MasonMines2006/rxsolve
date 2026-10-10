"""Settings shared by the coordinator scripts."""

import getpass
import hashlib
import os
import secrets
import sys
from pathlib import Path

DEFAULT_PORT = 8787
DEFAULT_URL = f"http://127.0.0.1:{DEFAULT_PORT}"

DATA_DIR = Path(
    os.environ.get("COORDINATOR_DATA_DIR", Path.home() / ".cache" / "agent-coordinator")
)
TOKEN_FILE = DATA_DIR / "token"
STATE_FILE = DATA_DIR / "service.json"
PASSWORD_SALT = b"agent-coordinator-v1"
PASSWORD_ROUNDS = 600_000
MIN_PASSWORD_LENGTH = 10


def token_from_password(password: str) -> str:
    """Derive the shared secret from a password. The same password gives the same token on every computer."""
    return hashlib.pbkdf2_hmac("sha256", password.encode(), PASSWORD_SALT, PASSWORD_ROUNDS).hex()


def generate_password(words: int = 5) -> str:
    """Pick random words, for example `amber-otter-quartz-linen-sage` (about 39 bits)."""
    from words import WORDS

    return "-".join(secrets.choice(WORDS) for _ in range(words))


def save_token(token: str) -> None:
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(token)
    TOKEN_FILE.chmod(0o600)


def prompt_password(confirm: bool) -> str:
    """Ask for the password on the terminal. Exits if there is no terminal."""
    if not sys.stdin.isatty():
        raise SystemExit("No terminal to ask for a password. Set COORDINATOR_PASSWORD or COORDINATOR_TOKEN.")
    while True:
        password = getpass.getpass("Coordinator password: ")
        if len(password) < MIN_PASSWORD_LENGTH:
            print(f"Use at least {MIN_PASSWORD_LENGTH} characters. A few random words work well.")
        elif confirm and getpass.getpass("Repeat password: ") != password:
            print("The passwords differ.")
        else:
            return password


def read_token() -> str:
    """Return the shared secret from the environment or the token file."""
    token = os.environ.get("COORDINATOR_TOKEN")
    if token:
        return token
    password = os.environ.get("COORDINATOR_PASSWORD")
    if password:
        return token_from_password(password)
    try:
        return TOKEN_FILE.read_text().strip()
    except FileNotFoundError:
        raise SystemExit(
            "Not joined yet. Run `client.py join` and enter the password, "
            "or set COORDINATOR_PASSWORD or COORDINATOR_TOKEN."
        )
