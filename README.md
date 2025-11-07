# Todo API

This is a simple Todo API built with FastAPI, providing basic CRUD (Create, Read, Update, Delete) operations for managing todo items.

## Features

*   **Create:** Add new todo items.
*   **Read:** Retrieve all todo items or a single todo item by ID.
*   **Update:** Modify existing todo items.
*   **Delete:** Remove todo items.

## Technologies Used

*   **Python 3.9+**
*   **FastAPI**: A modern, fast (high-performance) web framework for building APIs with Python 3.7+ based on standard Python type hints.
*   **Uvicorn**: An ASGI server for Python web applications.
*   **Pydantic**: Data validation and settings management using Python type hints.

## Local Development Setup

Follow these steps to get the project up and running on your local machine.

### Prerequisites

*   Python 3.9+ installed.
*   `pip` (Python package installer).

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/ayush2991/todo.git
    cd todo
    ```

2.  **Create a virtual environment (recommended):**
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

### Running the Application

To start the FastAPI application locally:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

The API will be accessible at `http://localhost:8000`.

## API Endpoints

The API provides the following endpoints:

### 1. Get all Todo Items

*   **URL:** `/todos`
*   **Method:** `GET`
*   **Response:** `200 OK` with a list of todo items.
    ```json
    [
        {
            "id": 1,
            "title": "Buy groceries",
            "description": "Milk, Bread, Cheese",
            "completed": false
        },
        {
            "id": 2,
            "title": "Learn FastAPI",
            "description": null,
            "completed": true
        }
    ]
    ```

### 2. Get a Single Todo Item

*   **URL:** `/todos/{todo_id}`
*   **Method:** `GET`
*   **Path Parameters:**
    *   `todo_id` (integer): The ID of the todo item to retrieve.
*   **Response:** `200 OK` with the specified todo item, or `404 Not Found` if the ID does not exist.
    ```json
    {
        "id": 1,
        "title": "Buy groceries",
        "description": "Milk, Bread, Cheese",
        "completed": false
    }
    ```

### 3. Create a New Todo Item

*   **URL:** `/todos`
*   **Method:** `POST`
*   **Request Body (JSON):**
    ```json
    {
        "id": 3,
        "title": "Walk the dog",
        "description": "Take Fido for a walk in the park",
        "completed": false
    }
    ```
*   **Response:** `201 Created` with the newly created todo item, or `400 Bad Request` if a todo with the same ID already exists.

### 4. Update an Existing Todo Item

*   **URL:** `/todos/{todo_id}`
*   **Method:** `PUT`
*   **Path Parameters:**
    *   `todo_id` (integer): The ID of the todo item to update.
*   **Request Body (JSON):**
    ```json
    {
        "id": 1,
        "title": "Buy groceries",
        "description": "Milk, Bread, Cheese, Eggs",
        "completed": true
    }
    ```
*   **Response:** `200 OK` with the updated todo item, or `404 Not Found` if the ID does not exist.

### 5. Delete a Todo Item

*   **URL:** `/todos/{todo_id}`
*   **Method:** `DELETE`
*   **Path Parameters:**
    *   `todo_id` (integer): The ID of the todo item to delete.
*   **Response:** `204 No Content` if successful, or `404 Not Found` if the ID does not exist.

## Deployment to Google Cloud Run

This application can be easily deployed to Google Cloud Run directly from its GitHub repository.

### Prerequisites for Cloud Run Deployment

1.  **Google Cloud Project:** Ensure you have an active Google Cloud Project.
2.  **`gcloud` CLI:** Install and authenticate the Google Cloud SDK (`gcloud auth login`).
3.  **APIs Enabled:** Enable the Cloud Run API and Cloud Build API in your GCP project.
4.  **GitHub Connection:** Connect your GitHub repository to Google Cloud Build. This is crucial for `--source` deployments. You can do this via the Google Cloud Console: `Cloud Build` -> `Settings` -> `GitHub App`.

### Manual Deployment

To deploy the current state of your GitHub repository to Cloud Run:

```bash
gcloud run deploy todo-app \
  --source https://github.com/ayush2991/todo \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --project YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with your actual Google Cloud Project ID and `us-central1` with your desired region.

### Continuous Deployment (Optional)

For automatic deployments every time you push changes to your GitHub repository, set up a **Cloud Build Trigger**:

1.  Go to `Cloud Build` -> `Triggers` in the Google Cloud Console.
2.  Click **"Create trigger"**.
3.  Configure the trigger to:
    *   Monitor pushes to a specific branch (e.g., `main`) of your `ayush2991/todo` GitHub repository.
    *   Use **"Autodetected (Dockerfile or Buildpacks)"** for the build configuration.
    *   Target your Cloud Run service (`todo-app`) in the correct region.

This will ensure that your Cloud Run service is always up-to-date with your latest code on GitHub.
