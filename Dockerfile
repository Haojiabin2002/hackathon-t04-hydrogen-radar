FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY radar/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app
RUN chmod +x /app/deploy/entrypoint.sh

EXPOSE 8000

CMD ["/app/deploy/entrypoint.sh"]
