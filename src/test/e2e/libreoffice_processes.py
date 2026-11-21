"""Reproduce launcher cleanup with a descendant that retains stdout."""

import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import sys


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path)
parser.add_argument("--python", default=sys.executable)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("macro_engine", Path(__file__).resolve().parents[3] / "assets/macro_engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
bridge = engine.LibreOfficeBridge("unused", args.directory)
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
script = f"import subprocess,time; child=subprocess.Popen([{args.python!r},'-c','import time; time.sleep(120)'], creationflags={flags}); print(child.pid,flush=True); time.sleep(120)"
try:
    bridge.process = subprocess.Popen([args.python, "-u", "-c", script], stdout=subprocess.PIPE,
                                      start_new_session=bridge.own_process_group,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    assert bridge.process.stdout.readline().strip().isdigit(), "Descendant did not start"
finally:
    bridge.stop()
assert bridge.process.returncode is not None, "Launcher survived cleanup"
assert bridge.process.stdout.read() == b"", "Descendant still holds the pipe"
assert not bridge.profile.exists(), "Standalone profile was not removed"
print("Standalone process tree cleanup passed")
