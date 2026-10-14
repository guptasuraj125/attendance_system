"""Keep a direct pytest run isolated from configured and demo databases."""
import os
import uuid


_owns_database = os.environ.get("HRONE_QA_ISOLATED") != "1"
if _owns_database:
    # These tests write data, so never let a direct pytest invocation target a
    # developer's .env or remotely configured cluster.
    os.environ["MONGO_URI"] = "mongodb://localhost:27017"
    os.environ["MONGO_DB"] = f"attendance_pytest_{uuid.uuid4().hex}"


def pytest_unconfigure(config):
    if _owns_database:
        from pymongo import MongoClient

        uri = os.environ["MONGO_URI"]
        database = os.environ["MONGO_DB"]
        client = MongoClient(uri, serverSelectionTimeoutMS=3000)
        try:
            client.drop_database(database)
            print(f"Removed temporary database: {database}")
        finally:
            client.close()
