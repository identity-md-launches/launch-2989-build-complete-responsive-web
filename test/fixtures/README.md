The JSON files in `api/` are real, public Squeekchain API responses captured on
2026-11-05 at approximately 09:13 UTC. They are regression fixtures, **not live
data**. `runs-next.json` is the page reached using `runs.json`'s opaque cursor.

Tests replay these responses and explicitly simulate failures, old snapshots and
new events to check transitions. No fixture or simulated event is imported by
the application or copied into `dist/`. The deployed application always requests
the official public API.
