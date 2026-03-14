import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import CORS_ORIGINS, DATA_PATH
from backend.routers.events import router, set_repo
from backend.storage.json_storage import JSONEventRepository

app = FastAPI(title="Agenda Madrid API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = JSONEventRepository(DATA_PATH)
set_repo(repo)

app.include_router(router)

frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
