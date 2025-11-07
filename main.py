from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional

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

class Todo(BaseModel):
    id: Optional[str] = None  # Firestore document IDs are strings
    title: str
    description: Optional[str] = None
    completed: bool = False

@app.get("/todos", response_model=List[Todo])
def get_todos():
    """
    Get all todo items from Firestore.
    """
    todos_ref = db.collection("todos")
    all_todos = []
    for doc in todos_ref.stream():
        data = doc.to_dict() or {}
        # Ensure we don't pass an 'id' value twice (doc.id + data['id'])
        data.pop("id", None)
        all_todos.append(Todo(id=doc.id, **data))
    return all_todos

@app.get("/todos/{todo_id}", response_model=Todo)
def get_todo(todo_id: str):
    """
    Get a single todo item by its ID from Firestore.
    """
    todo_ref = db.collection("todos").document(todo_id)
    doc = todo_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Todo not found")
    data = doc.to_dict() or {}
    data.pop("id", None)
    return Todo(id=doc.id, **data)

@app.post("/todos", response_model=Todo, status_code=201)
def create_todo(todo: Todo):
    """
    Create a new todo item in Firestore.
    """
    todos_ref = db.collection("todos")
    if todo.id:
        # Check if a todo with this ID already exists
        doc = todos_ref.document(todo.id).get()
        if doc.exists:
            raise HTTPException(status_code=400, detail="Todo with this ID already exists")
        doc_ref.set(todo.model_dump(exclude_unset=True))
    else:
        # Let Firestore generate an ID
        doc_ref = todos_ref.document()
        todo.id = doc_ref.id  # Assign the generated ID to the Pydantic model
        doc_ref.set(todo.model_dump(exclude_unset=True))

    # Retrieve the newly created/set document to ensure consistency in the response
    created_doc = doc_ref.get()
    data = created_doc.to_dict() or {}
    data.pop("id", None) # Remove 'id' from data to avoid conflict with doc.id
    return Todo(id=created_doc.id, **data)

@app.put("/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: str, updated_todo: Todo):
    """
    Update an existing todo item in Firestore.
    """
    todo_ref = db.collection("todos").document(todo_id)
    doc = todo_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Todo not found")

    # Update the document with the new data
    todo_ref.update(updated_todo.model_dump(exclude_unset=True))
    updated = todo_ref.get()
    data = updated.to_dict() or {}
    data.pop("id", None)
    return Todo(id=todo_id, **data)

@app.delete("/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: str):
    """
    Delete a todo item from Firestore.
    """
    todo_ref = db.collection("todos").document(todo_id)
    doc = todo_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo_ref.delete()
    return
