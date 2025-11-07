from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, validator
from typing import List, Optional
from datetime import datetime

from google.cloud import firestore

app = FastAPI(title="Todo API")

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve index.html at the root
@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

# Initialize Firestore DB
db = firestore.Client()

class Task(BaseModel):
    id: Optional[str] = None
    title: str
    duration: int = 60
    scheduledStart: Optional[str] = None
    recurrence: Optional[dict] = None
    

    @validator('title')
    def title_must_not_be_empty(cls, v):
        if not isinstance(v, str) or not v.strip():
            raise ValueError('title must be a non-empty string')
        return v.strip()

    @validator('duration')
    def duration_must_be_reasonable(cls, v):
        if not isinstance(v, int):
            raise ValueError('duration must be an integer')
        # Enforce minimum 15 minutes and maximum 3 hours (180 minutes)
        if v < 15 or v > 3 * 60:
            raise ValueError('duration must be between 15 and 180 minutes')
        return v

    @validator('scheduledStart')
    def scheduled_start_must_be_iso_or_none(cls, v):
        if v is None:
            return v
        if not isinstance(v, str):
            raise ValueError('scheduledStart must be an ISO datetime string')
        try:
            # allow date/time with or without seconds
            datetime.fromisoformat(v)
        except Exception:
            raise ValueError('scheduledStart must be a valid ISO datetime string')
        return v

    @validator('recurrence')
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

# --- Task API (primary and only public API) ---


@app.get("/tasks/", response_model=List[Task])
def list_tasks():
    """Return all tasks (backed by Firestore 'todos' collection for continuity)."""
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


@app.post("/tasks/")
def create_task(task: dict):
    """Create a new task in the 'todos' collection.

    This endpoint accepts partial input and applies sensible defaults server-side
    so clients don't accidentally create malformed documents. All fields are
    validated before writing to Firestore.
    Returns the new document ID.
    """
    coll = db.collection("todos")
    # Allow callers to pass partial payloads. Normalize and fill defaults.
    title = (task.get('title') or '').strip() or 'Untitled'
    duration = int(task.get('duration') or 60)
    scheduledStart = task.get('scheduledStart') if task.get('scheduledStart') else None
    recurrence = task.get('recurrence') if task.get('recurrence') else None

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
    return {"id": doc_ref.id}


@app.put("/tasks/{task_id}", response_model=Task)
def update_task(task_id: str, task: Task):
    """Merge update an existing task in the 'todos' collection and return updated resource."""
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
    coll = db.collection("todos")
    ref = coll.document(task_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    ref.delete()
    return
