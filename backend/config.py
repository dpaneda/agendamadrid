import os


API_KEY = os.getenv("API_KEY", "test")
DATA_PATH = os.getenv("DATA_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "events.json"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
