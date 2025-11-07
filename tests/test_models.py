import pytest
from main import Task
from pydantic import ValidationError


def test_task_valid_minimal():
    t = Task(title='Hello', duration=30)
    assert t.title == 'Hello'
    assert t.duration == 30


def test_title_must_not_be_empty():
    with pytest.raises(ValidationError):
        Task(title='   ', duration=30)


def test_duration_bounds_too_small():
    with pytest.raises(ValidationError):
        Task(title='A', duration=10)


def test_duration_bounds_too_large():
    with pytest.raises(ValidationError):
        Task(title='A', duration=1000)


def test_duration_must_be_int():
    with pytest.raises(ValidationError):
        Task(title='A', duration='sixty')


def test_scheduled_start_validation():
    # None is allowed
    t = Task(title='A', duration=30, scheduledStart=None)
    assert t.scheduledStart is None
    # valid ISO
    t2 = Task(title='A', duration=30, scheduledStart='2025-11-07T10:00')
    # normalized to canonical UTC ISO (seconds + 'Z')
    assert t2.scheduledStart == '2025-11-07T10:00:00Z'
    # invalid string should raise
    with pytest.raises(ValidationError):
        Task(title='A', duration=30, scheduledStart='not-a-date')


def test_recurrence_validation_custom_days():
    # valid custom
    t = Task(title='A', duration=30, recurrence={'type': 'custom', 'days': [1, 3, 5]})
    assert t.recurrence['type'] == 'custom'
    # invalid days
    with pytest.raises(ValidationError):
        Task(title='A', duration=30, recurrence={'type': 'custom', 'days': ['mon']})


def test_recurrence_type_invalid():
    with pytest.raises(ValidationError):
        Task(title='A', duration=30, recurrence={'type': 'yearly'})
