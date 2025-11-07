from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="Todo API")

class Todo(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    completed: bool = False

# In-memory database
db: List[Todo] = [
    Todo(id=1, title="Buy groceries", description="Milk, Bread, Cheese"),
    Todo(id=2, title="Learn FastAPI", completed=True),
]

@app.get("/todos", response_model=List[Todo])
def get_todos():
    """
    Get all todo items.
    """
    return db

@app.get("/todos/{todo_id}", response_model=Todo)
def get_todo(todo_id: int):
    """
    Get a single todo item by its ID.
    """
    todo = next((todo for todo in db if todo.id == todo_id), None)
    if todo is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todo

@app.post("/todos", response_model=Todo, status_code=201)
def create_todo(todo: Todo):
    """
    Create a new todo item.
    """
    if any(t.id == todo.id for t in db):
        raise HTTPException(status_code=400, detail="Todo with this ID already exists")
    db.append(todo)
    return todo

@app.put("/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: int, updated_todo: Todo):
    """
    Update an existing todo item.
    """
    index = next((i for i, t in enumerate(db) if t.id == todo_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    db[index] = updated_todo
    return updated_todo

@app.delete("/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: int):
    """
    Delete a todo item.
    """
    global db
    initial_len = len(db)
    db = [t for t in db if t.id != todo_id]
    if len(db) == initial_len:
        raise HTTPException(status_code=404, detail="Todo not found")
    return
