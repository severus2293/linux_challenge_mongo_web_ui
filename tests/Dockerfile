FROM python:3.10-slim

WORKDIR /app

RUN pip install locust==2.32.5 pymongo

COPY temp_users.json /app/
COPY main.py /app/

EXPOSE 8089

CMD ["locust", "-f", "main.py", "--host", "http://localhost:8888"]
