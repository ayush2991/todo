from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime, timezone
import os
import logging

from google.cloud import firestore

app = FastAPI(title="Todo API")

# Basic structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("todo")

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve index.html at the root
@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

# Initialize Firestore DB (safe, env-aware)
def _init_firestore_client():
    # Prefer explicit project env var if provided
    project = os.environ.get("FIRESTORE_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    # Detect emulator usage
    emulator = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if emulator:
        logger.info("Detected Firestore emulator via FIRESTORE_EMULATOR_HOST=%s", emulator)
    try:
        if project:
            logger.info("Initializing Firestore client with project=%s", project)
            return firestore.Client(project=project)
        logger.info("Initializing Firestore client with default credentials")
        return firestore.Client()
    except Exception as exc:
        logger.exception("Failed to initialize Firestore client: %s", exc)
        return None


db = _init_firestore_client()

class Task(BaseModel):
    id: Optional[str] = None
    title: str
    duration: int = 60
    scheduledStart: Optional[str] = None
    recurrence: Optional[dict] = None
    

    @field_validator('title')
    def title_must_not_be_empty(cls, v):
        if not isinstance(v, str) or not v.strip():
            raise ValueError('title must be a non-empty string')
        return v.strip()

    @field_validator('duration')
    def duration_must_be_reasonable(cls, v):
        if not isinstance(v, int):
            raise ValueError('duration must be an integer')
        # Enforce minimum 15 minutes and maximum 3 hours (180 minutes)
        if v < 15 or v > 3 * 60:
            raise ValueError('duration must be between 15 and 180 minutes')
        return v

    @field_validator('scheduledStart')
    def scheduled_start_must_be_iso_or_none(cls, v):
        if v is None:
            return v
        if not isinstance(v, str):
            raise ValueError('scheduledStart must be an ISO datetime string')
        try:
            # parse ISO datetime; accept with or without timezone
            dt = datetime.fromisoformat(v)
            # If naive, assume UTC to avoid ambiguous storage. Clients should
            # prefer sending timezone-aware timestamps (with 'Z' or an offset).
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            # Normalize to UTC and return canonical ISO with 'Z' (no microseconds)
            dt_utc = dt.astimezone(timezone.utc).replace(microsecond=0)
            return dt_utc.isoformat().replace('+00:00', 'Z')
        except Exception:
            raise ValueError('scheduledStart must be a valid ISO datetime string')

    @field_validator('recurrence')
    def recurrence_must_be_well_formed(cls, v):
        if v is None:
            return v
        if not isinstance(v, dict):
            raise ValueError('recurrence must be an object')
        t = v.get('type')
        if t not in (None, 'none', 'daily', 'weekly', 'weekdays', 'weekends', 'custom'):
            raise ValueError("recurrence.type must be one of 'none','daily','weekly','weekdays','weekends','custom'")
        if t == 'custom':
            days = v.get('days')
            if not isinstance(days, list) or not all(isinstance(x, int) and 0 <= x <= 6 for x in days):
                raise ValueError('recurrence.days must be a list of weekday numbers 0-6')
        return v


class TaskCreate(BaseModel):
    title: Optional[str] = None
    duration: Optional[int] = None
    scheduledStart: Optional[str] = None
    recurrence: Optional[dict] = None


# --- Task API (primary and only public API) ---


@app.get("/tasks/", response_model=List[Task])
def list_tasks():
    """Return all tasks (backed by Firestore 'todos' collection for continuity)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Datastore not available")
    coll = db.collection("todos")
    out: List[Task] = []
    for doc in coll.stream():
        data = doc.to_dict() or {}
        # Backfill defaults expected by planner UI
        data.setdefault("duration", 60)
        data.setdefault("scheduledStart", None)
        data.setdefault("recurrence", None)
        data.pop("id", None)
        out.append(Task(id=doc.id, **data))
    return out





@app.put("/tasks/{task_id}", response_model=Task)
def update_task(task_id: str, task: Task):
    """Merge update an existing task in the 'todos' collection and return updated resource."""
    if db is None:
        raise HTTPException(status_code=503, detail="Datastore not available")
    coll = db.collection("todos")
    ref = coll.document(task_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    data = task.model_dump(exclude_unset=True)
    data.pop("id", None)
    ref.set(data, merge=True)
    updated = ref.get().to_dict() or {}
    updated.setdefault("duration", 60)
    updated.setdefault("scheduledStart", None)
    updated.setdefault("recurrence", None)
    updated.pop("id", None)
    return Task(id=task_id, **updated)


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str):
    """Delete a task from the 'todos' collection."""
    if db is None:
        raise HTTPException(status_code=503, detail="Datastore not available")
    coll = db.collection("todos")
    ref = coll.document(task_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    ref.delete()
    return


@app.post("/tasks/", response_model=Task)
def create_task(task: TaskCreate):
    """Create a new task in the 'todos' collection.

    Accepts partial input (TaskCreate), applies server defaults, validates by
    constructing a full `Task`, writes to Firestore, and returns the created
    Task resource (including the assigned `id`).
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Datastore not available")
    coll = db.collection("todos")
    # Normalize and fill defaults.
    title = (task.title or '').strip() or 'Untitled'
    duration = int(task.duration) if task.duration is not None else 60
    scheduledStart = task.scheduledStart if task.scheduledStart else None
    recurrence = task.recurrence if task.recurrence else None

    # Validate by instantiating Task (will raise 422 if invalid)
    validated = Task(
        title=title,
        duration=duration,
        scheduledStart=scheduledStart,
        recurrence=recurrence,
    )

    payload = validated.model_dump()
    payload.pop('id', None)
    doc_ref = coll.document()
    doc_ref.set(payload)

    # Return the canonical server resource
    stored = coll.document(doc_ref.id).get().to_dict() or {}
    stored.setdefault("duration", 60)
    stored.setdefault("scheduledStart", None)
    stored.setdefault("recurrence", None)
    stored.pop('id', None)
    return Task(id=doc_ref.id, **stored)
