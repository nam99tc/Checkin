#!/usr/bin/env python3
"""
HTTP -> RabbitMQ bridge for the check-in web (deployed on Render).

Each check-in is TWO safe server calls (no ts-webhook, which crashes dmpw via a
background VMS thread touching a disposed DbContext):

  1. Publish a device event to RabbitMQ (.topic.event.{deviceAddress}) ->
     EventLogConsumer builds the full "Face ID" EventLog. ImageFile is empty.
  2. POST the photo to  /event-logs/{deviceAddress}/images  (AllowAnonymous) ->
     UploadImageToEventLog finds the event by (device, EventTime, CardId) and
     attaches the image. This path is synchronous (no background thread) = safe.

    POST /fire-event   {cardId, userName, accessTime, imageUrl,
                        [deviceAddress, issueCount]}
    GET  /health

RabbitMQ connection comes from env vars (set them in the Render dashboard):
    RMQ_HOST RMQ_PORT RMQ_VHOST RMQ_USER RMQ_PASS
"""
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid

import pika
from flask import Flask, request, jsonify, make_response

EXCHANGE = "amq.topic"
DEFAULT_DEVICE_ADDRESS = "840106"
DMPW_API = "https://api.duallmaster.com"
UPLOAD_DELAY = float(os.environ.get("UPLOAD_DELAY", "2.0"))  # let the event be created first

RMQ_HOST = os.environ.get("RMQ_HOST", "mq.demasterpro.com")
RMQ_PORT = int(os.environ.get("RMQ_PORT", "5672"))
RMQ_VHOST = os.environ.get("RMQ_VHOST", "/")
RMQ_USER = os.environ.get("RMQ_USER", "icuclient")
RMQ_PASS = os.environ.get("RMQ_PASS", "")  # required; set in Render env

app = Flask(__name__)


def build_event_message(card_id, user_name, access_time, device_address, issue_count):
    event = {
        "DeviceAddress": device_address,
        "AccessTime": access_time,          # ddMMyyyyHHmmss
        "CardId": card_id,
        "IssueCount": issue_count,
        "UserName": user_name,
        "UserId": "",
        "UpdateTime": access_time,
        "InOut": "In",                      # device sends English -> displayed as "Vào"
        "EventType": 1,                     # NormalAccess
        "IdType": 4,                        # CardType.FaceId -> "Face ID"
        "CornerId": 0,
        "Temperature": 36.5,                # fixed, like real events
        "DelayOpenDoorByCamera": 0.0,
        "SendType": 0,
        "ImageFile": "",                    # empty -> image attached via step 2
        "Distance": 0.0,
        "SearchScore": 0.0,                 # real DC events report 0
        "LivenessScore": 0.0,
        "OtherCardId": "[]",
    }
    return {
        "MsgId": uuid.uuid4().hex,
        "Sender": device_address,
        "Type": "EVENT_LOG",
        "Data": {"Total": 1, "UtcHour": 7, "UtcMinute": 0, "Events": [event]},
    }


def publish(message, device_address):
    conn = pika.BlockingConnection(pika.ConnectionParameters(
        host=RMQ_HOST, port=RMQ_PORT, virtual_host=RMQ_VHOST,
        credentials=pika.PlainCredentials(RMQ_USER, RMQ_PASS)))
    try:
        conn.channel().basic_publish(
            exchange=EXCHANGE,
            routing_key=f".topic.event.{device_address}",
            body=json.dumps(message).encode("utf-8"),
            properties=pika.BasicProperties(content_type="application/json",
                                            delivery_mode=2))
    finally:
        conn.close()


def download_base64(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return base64.standard_b64encode(r.read()).decode("ascii")


def upload_image(device_address, card_id, access_time, image_b64):
    mid = uuid.uuid4().hex[:12]
    body = {
        "Id": mid,
        "Hash": hashlib.md5(f"{device_address}{mid}".encode()).hexdigest(),
        "Image": image_b64,
        "EventTime": access_time,
        "CardId": card_id,
    }
    req = urllib.request.Request(
        f"{DMPW_API}/event-logs/{device_address}/images",
        data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    return resp


@app.after_request
def add_cors(resp):
    return _cors(resp)


@app.route("/fire-event", methods=["POST", "OPTIONS"])
def fire_event():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    data = request.get_json(force=True, silent=True) or {}
    card_id = data.get("cardId")
    access_time = data.get("accessTime")
    image_url = data.get("imageUrl")
    if not card_id or not access_time:
        return jsonify(ok=False, error="cardId and accessTime are required"), 400
    device_address = data.get("deviceAddress") or DEFAULT_DEVICE_ADDRESS
    issue_count = int(data.get("issueCount") or 1)

    # 1. publish the full event
    message = build_event_message(card_id, data.get("userName") or "", access_time,
                                  device_address, issue_count)
    try:
        publish(message, device_address)
    except Exception as e:
        return jsonify(ok=False, step="mqtt", error=str(e)), 502

    # 2. attach the photo (best-effort; the event already exists without it)
    upload = None
    if image_url:
        try:
            time.sleep(UPLOAD_DELAY)
            img_b64 = download_base64(image_url)
            status, text = upload_image(device_address, card_id, access_time, img_b64)
            upload = {"status": status, "body": text}
        except Exception as e:
            upload = {"error": str(e)}

    return jsonify(ok=True, routingKey=f".topic.event.{device_address}",
                   accessTime=access_time, upload=upload)


@app.route("/health")
def health():
    return jsonify(ok=True, broker=f"{RMQ_HOST}:{RMQ_PORT}", hasPass=bool(RMQ_PASS))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8787")))
