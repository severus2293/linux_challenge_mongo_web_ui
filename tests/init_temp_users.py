import requests
import json
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from bson import ObjectId

admin_headers = {
    "Authorization": "Bearer SuperAdminMongoToken"
}

users = []
num_users = 250
docs_per_collection = 100
num_collections = 5


def create_user_and_data(i):
    try:
        r = requests.get("http://localhost:8081/create_temp_db", headers=admin_headers)
        r.raise_for_status()
        data = r.json()

        username = data["username"]
        password = data["password"]
        db_name = data["dbName"]

        session = requests.Session()
        auth_resp = session.post(
            "http://localhost:8081/login",
            data={"username": username, "password": password}
        )

        for k in range(num_collections):
            coll_name = f"testcol{k}"
            create_coll = session.post(
                f"http://localhost:8081/db/{db_name}",
                json={"collection": coll_name}
            )
            if create_coll.status_code not in (200, 201):
                return f"[!] Failed to create collection: {create_coll.text}"

            # создаём документы
            docs = []
            for j in range(docs_per_collection):
                docs.append({
                    "_id": str(ObjectId()),
                    "index": j,
                    "name": f"user_{j}",
                    "random": round(random.random(), 4)
                })

            for chunk_start in range(0, docs_per_collection, 10):
                chunk = docs[chunk_start:chunk_start + 10]
                for doc in chunk:
                    resp = session.post(
                        f"http://localhost:8081/db/{db_name}/{coll_name}",
                        json={"document": json.dumps(doc)}
                    )
                    if resp.status_code not in (200, 201):
                        return f"[!] Failed to insert doc for {username}: {resp.status_code}"

        return {
            "username": username,
            "password": password,
            "db": db_name
        }

    except Exception as e:
        return f"[!] Exception for user {i}: {str(e)}"


with ThreadPoolExecutor(max_workers=16) as executor:
    futures = [executor.submit(create_user_and_data, i) for i in range(num_users)]
    for idx, future in enumerate(as_completed(futures), 1):
        result = future.result()
        if isinstance(result, dict):
            users.append(result)
            print(f"[✓] Created user {result['username']} ({idx}/{num_users})")
        else:
            print(result)

with open("temp_users.json", "w") as f:
    json.dump(users, f, indent=2)

print(f"[✓] Created and saved {len(users)} users in temp_users.json")
