from locust import HttpUser, task, between, tag
from bson import ObjectId
from urllib.parse import quote
import random
import json
import queue

with open("temp_users.json") as f:
    TEMP_USERS = json.load(f)

COLLS = [f"testcol{i}" for i in range(5)]

USER_QUEUE = queue.Queue()
for user in TEMP_USERS:
    USER_QUEUE.put(user)


class MongoUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        self.colls_for_delete = []
        self.doc_ids_by_coll = {}
        try:
            self.user = USER_QUEUE.get_nowait()
        except queue.Empty:
            raise Exception("[!] Ran out of users!")

        with self.client.get("/login", allow_redirects=False, catch_response=True) as resp:
            if resp.status_code not in (200, 302):
                resp.failure(f"Initial GET /login failed: {resp.status_code}")
            else:
                resp.success()

        with self.client.post(
                "/login",
                data={"username": self.user["username"], "password": self.user["password"]},
                allow_redirects=False,
                catch_response=True
        ) as res:
            if res.status_code not in (200, 302):
                res.failure(f"Login failed ({res.status_code}): {res.text}")
            elif "login" in res.headers.get("Location", ""):
                res.failure("Redirected to login after POST /login — auth likely failed")
            else:
                res.success()
        self.db = self.user["db"]

        self.db = self.user["db"]
        self.collection = "initial"

    @task(10)
    @tag("view")
    def view_collections(self):
        self.client.get("/", name="View collections", allow_redirects=False)

    @task(10)
    @tag("aggregate_heavy")
    def aggregate_query(self):
        coll = random.choice(COLLS)
        pipeline = [
            {"$match": {"index": {"$gt": 0}}},
            {"$group": {"_id": "$category", "total": {"$sum": 1}}},
            {"$sort": {"total": -1}}
        ]
        query_str = quote(json.dumps(pipeline))
        self.client.get(
            f"/db/{self.db}/{coll}?query={query_str}&runAggregate=on&projection=",
            name="Aggregate heavy",
            allow_redirects=False)

    @task(10)
    @tag("regex_query")
    def regex_query(self):
        coll = random.choice(COLLS)
        query = {"name": {"$regex": "user_", "$options": "i"}}
        query_str = quote(json.dumps(query))
        self.client.get(
            f"/db/{self.db}/{coll}?query={query_str}&projection=",
            name="Regex query",
            allow_redirects=False)

    @task(8)
    @tag("create_doc")
    def create_document(self):
        coll = random.choice(COLLS)
        doc_id = str(ObjectId())
        payload = {
            "document": json.dumps({"_id": doc_id, "name": f"user_{str(doc_id)}"})
        }
        with self.client.post(
                f"/db/{self.db}/{coll}",
                json=payload,
                name="Create document",
                allow_redirects=False,
                catch_response=True
        ) as r:
            if r.status_code not in (200, 201, 302):
                r.failure(f"Create failed: {r.status_code}")
            else:
                self.doc_ids_by_coll.setdefault(coll, []).append(doc_id)
                r.success()

    @task(6)
    @tag("update_doc")
    def update_document(self):
        coll = random.choice(COLLS)
        if self.doc_ids_by_coll.get(coll):
            doc_id = f'"{random.choice(self.doc_ids_by_coll[coll])}"'
            payload = {
                "document": json.dumps({"_id": doc_id, "name": "upd"}),
                "_method": "put"
            }
            self.client.post(
                f"/db/{self.db}/{coll}/{doc_id}?skip=0",
                json=payload,
                name="Update document",
                allow_redirects=False)

    @task(6)
    @tag("delete_doc")
    def delete_document(self):
        coll = random.choice(COLLS)
        if self.doc_ids_by_coll.get(coll):
            doc_id = f'"{random.choice(self.doc_ids_by_coll[coll])}"'
            with self.client.post(
                    f"/db/{self.db}/{coll}/{doc_id}",
                    json={"_method": "delete"},
                    name="Delete document",
                    allow_redirects=False,
                    catch_response=True
            ) as r:
                if doc_id in self.doc_ids_by_coll[coll]:
                    self.doc_ids_by_coll[coll].remove(doc_id)

    @task(3)
    @tag("create_coll")
    def create_collection(self):
        name = f"coll_{random.randint(1, 10000)}"
        self.client.post(
            f"/db/{self.db}",
            json={"collection": name},
            name="Create collection",
            allow_redirects=False)
        self.colls_for_delete.append(name)

    @task(3)
    @tag("delete_coll")
    def delete_collection(self):
        if not self.colls_for_delete:
            return
        coll = random.choice(self.colls_for_delete)
        self.client.post(
            f"/db/{self.db}/{coll}",
            json={"_method": "delete"},
            name="Delete collection",
            allow_redirects=False,
        )
        self.colls_for_delete.remove(coll)
