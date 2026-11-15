"""Entrypoint kept for `uvicorn main:app` (see README)."""

from app.main import create_app

app = create_app()
