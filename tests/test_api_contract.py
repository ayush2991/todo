from fastapi.testclient import TestClient
import main


class FakeSnapshot:
    def __init__(self, data):
        self._data = data
    def to_dict(self):
        return self._data
    @property
    def exists(self):
        return bool(self._data)


class FakeDocRef:
    def __init__(self, collection, doc_id):
        self._col = collection
        self.id = doc_id

    def set(self, payload, merge=False):
        if merge and self.id in self._col.store:
            # merge
            self._col.store[self.id].update(payload)
        else:
            self._col.store[self.id] = dict(payload)

    def get(self):
        data = self._col.store.get(self.id)
        return FakeSnapshot(data)

    def delete(self):
        if self.id in self._col.store:
            del self._col.store[self.id]


class FakeCollection:
    def __init__(self, name):
        self.name = name
        self.store = {}  # id -> data
        self._counter = 0

    def stream(self):
        for _id, data in list(self.store.items()):
            snap = type('Doc', (), {})()
            snap.id = _id
            snap._data = data
            def to_dict(self):
                return self._data
            snap.to_dict = to_dict.__get__(snap, snap.__class__)
            yield snap

    def document(self, doc_id=None):
        if not doc_id:
            # create new id
            self._counter += 1
            doc_id = f'doc{self._counter}'
        return FakeDocRef(self, doc_id)


class FakeDB:
    def __init__(self):
        self._cols = {}

    def collection(self, name):
        if name not in self._cols:
            self._cols[name] = FakeCollection(name)
        return self._cols[name]


def test_crud_lifecycle(monkeypatch):
    # replace the real Firestore client with our fake
    fake_db = FakeDB()
    monkeypatch.setattr(main, 'db', fake_db)
    client = TestClient(main.app)

    # Create
    res = client.post('/tasks/', json={'title': 'Test task', 'duration': 45})
    assert res.status_code == 200
    payload = res.json()
    assert 'id' in payload
    created_id = payload['id']

    # List
    res2 = client.get('/tasks/')
    assert res2.status_code == 200
    tasks = res2.json()
    assert any(t['id'] == created_id for t in tasks)

    # Update
    res3 = client.put(f'/tasks/{created_id}', json={'title': 'Updated', 'duration': 60})
    assert res3.status_code == 200
    updated = res3.json()
    assert updated['title'] == 'Updated'
    assert updated['duration'] == 60

    # Delete
    res4 = client.delete(f'/tasks/{created_id}')
    assert res4.status_code == 204
    # Confirm deletion
    res5 = client.get('/tasks/')
    assert res5.status_code == 200
    assert not any(t['id'] == created_id for t in res5.json())
