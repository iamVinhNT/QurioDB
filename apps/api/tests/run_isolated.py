"""run_isolated.py — Run deterministic suites with a disposable HOME and no provider network access.

Usage (from apps/api): venv/bin/python tests/run_isolated.py -m rag -q
"""
import os
from pathlib import Path
import socket
import sys
import tempfile
from unittest.mock import patch

import dotenv


def main():
    sys.path.insert(0, os.getcwd())
    with tempfile.TemporaryDirectory(prefix="quriodb-tests-") as directory:
        with patch.object(Path, "home", return_value=Path(directory)), patch.object(
            dotenv, "load_dotenv", return_value=False,
        ), patch.object(socket.socket, "connect", side_effect=RuntimeError("Network disabled in isolated tests")):
            import pytest
            return pytest.main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
