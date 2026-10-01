FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 POSTPILOT_HOME=/data
WORKDIR /app/postpilot
# server-only deps (no pywebview/pystray/keyring: secrets fall back to /data/secrets.json)
RUN pip install --no-cache-dir fastapi uvicorn python-multipart requests tzdata psycopg2-binary pillow imageio-ffmpeg
COPY . .
VOLUME /data
EXPOSE 47821
CMD ["python", "docker_entry.py"]
