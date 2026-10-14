"""Run destructive integration tests only in a unique local MongoDB database."""
import os
import sys
import uuid

from pymongo import MongoClient


def main():
    # Deliberately ignore any configured remote URI: this suite must never touch it.
    uri = "mongodb://localhost:27017"
    database = f"attendance_qa_{uuid.uuid4().hex}"
    os.environ["MONGO_URI"] = uri
    os.environ["MONGO_DB"] = database
    os.environ["HRONE_QA_ISOLATED"] = "1"
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import pytest

    code = 1
    try:
        code = pytest.main([os.path.dirname(__file__), "-q"])
    finally:
        mongo = MongoClient(uri, serverSelectionTimeoutMS=3000)
        try:
            mongo.drop_database(database)
            print(f"Removed temporary database: {database}")
        finally:
            mongo.close()
    return int(code)


if __name__ == "__main__":
    sys.exit(main())
