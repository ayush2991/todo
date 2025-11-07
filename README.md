# Planner API (Tasks)

This repository implements a simple Planner (todo) API and single-page frontend. The backend is a FastAPI app that exposes CRUD endpoints for tasks and uses Google Firestore as the backing store. The frontend (under `static/`) provides an inbox + calendar UI that talks to the backend via `/tasks/` endpoints.

Key points:
- API base path: `/tasks/`
- Task model fields: `id` (string, assigned by Firestore), `title` (string), `duration` (int, minutes), `scheduledStart` (nullable ISO datetime string), `recurrence` (nullable object).
- OpenAPI docs are available automatically at `http://localhost:8000/docs` when the server is running.

## Quickstart (local)

1. Clone and enter the repo:

```bash
git clone https://github.com/ayush2991/todo.git
cd todo
```

2. Create and activate a virtualenv (recommended):

```bash
python3 -m venv .venv
source .venv/bin/activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Run the app:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` to see the frontend and `http://localhost:8000/docs` for the automatic API docs.

Note: The app expects access to Firestore. For local development you can use the Firestore emulator or configure Google application credentials through `GOOGLE_APPLICATION_CREDENTIALS` or environment-specific configuration.

## API Reference (current implementation)

All endpoints live under `/tasks/`.

- GET /tasks/  
  - Description: List all tasks. Returns an array of Task objects.
  - Response: 200 OK

- POST /tasks/  
  - Description: Create a new task. The server will apply defaults for missing fields.
  - Request body: JSON object with any of these fields (partial input is accepted but validation applies):
    - `title` (string) — recommended; empty title will be converted to `Untitled` by the server.
    - `duration` (integer minutes) — defaults to `60`. Validated to be between 15 and 180 minutes.
    - `scheduledStart` (string or null) — ISO datetime string, or `null` to leave unscheduled.
    - `recurrence` (object or null) — see recurrence schema below.
  - Response: 200 OK (JSON): `{ "id": "<document-id>" }` (the created document id).

- PUT /tasks/{task_id}  
  - Description: Update (merge) an existing task. Accepts the full Task object or a subset of fields; fields are merged into the existing document.
  - Request body: JSON object representing the task fields to update.
  - Response: 200 OK with the updated Task resource.

- DELETE /tasks/{task_id}  
  - Description: Delete the task.
  - Response: 204 No Content

### Task JSON shape (server-side model)

Example Task returned by the API:

```json
{
  "id": "XxYz123",
  "title": "Write report",
  "duration": 60,
  "scheduledStart": "2025-11-08T09:00",
  "recurrence": { "type": "weekly" }
}
```

Field notes:
- `id` — assigned by Firestore; clients should use this for updates/deletes.
- `title` — non-empty string; trimmed server-side.
- `duration` — minutes (integer). Server enforces 15 <= duration <= 180.
- `scheduledStart` — ISO datetime string. Currently the code accepts and stores naive ISO strings; consider time zone normalization if your deployment needs cross-timezone correctness.
- `scheduledStart` — ISO datetime string. The server normalizes accepted datetimes to UTC and stores/returns a canonical UTC ISO string (e.g. `2025-11-07T09:30:00Z`). Clients should prefer sending timezone-aware timestamps (with `Z` or an offset). If a naive timestamp is provided, the server assumes UTC when normalizing.
- `recurrence` — object with `type` (one of `none`, `daily`, `weekly`, `weekdays`, `weekends`, `custom`) and, when `custom`, a `days` array with weekday numbers 0 (Sunday) .. 6 (Saturday).

## Frontend

The UI is a small single-page app under `static/`:
- `static/index.html` — main page
- `static/styles.css` — styling
- `static/app.js` — client app that calls the `/tasks/` endpoints

The frontend and backend are currently in the same repository and the FastAPI app mounts the static folder so hosting is simple for development.

## Notes & Next Steps

- The repository README used to describe a `/todos` endpoint and a different task schema (id/title/description/completed). The current implementation uses `/tasks/` and the schema documented above. If you maintain external integrations, update them to use `/tasks/`.
- `KNOWN_ISSUES.md` lists further improvements (tests, docs, timezone handling, validation hardening). Recommended next step: add tests that assert the API shapes in this README.

If you want, I can also:
- Update the README examples to show curl commands for each endpoint.
- Generate and include the OpenAPI schema output as an example response file.
