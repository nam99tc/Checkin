#!/usr/bin/env python3
"""
HTTP -> RabbitMQ bridge for the check-in web (deployed on Render).

The browser can't open an AMQP socket, so on each check-in the web page calls
this bridge to publish the device event; the page then POSTs the photo webhook
~2s later (same AccessTime) so the webhook attaches the image to that event.

    POST /fire-event   {cardId, userName, accessTime, score,
                        [deviceAddress, temperature, issueCount]}
      -> publishes a ReceiveEventLogProtocolData message to exchange amq.topic,
         routing key .topic.event.{deviceAddress}, with ImageFile empty.
    GET  /health

RabbitMQ connection comes from env vars (set them in the Render dashboard):
    RMQ_HOST RMQ_PORT RMQ_VHOST RMQ_USER RMQ_PASS
"""
import json
import os
import random
import uuid

import pika
from flask import Flask, request, jsonify, make_response

EXCHANGE = "amq.topic"
DEFAULT_DEVICE_ADDRESS = "840106"

RMQ_HOST = os.environ.get("RMQ_HOST", "mq.demasterpro.com")
RMQ_PORT = int(os.environ.get("RMQ_PORT", "5672"))
RMQ_VHOST = os.environ.get("RMQ_VHOST", "/")
RMQ_USER = os.environ.get("RMQ_USER", "icuclient")
RMQ_PASS = os.environ.get("RMQ_PASS", "")  # required; set in Render env

app = Flask(__name__)


def build_event_message(card_id, user_name, access_time, score, device_address,
                        temperature, issue_count):
    event = {
        "DeviceAddress": device_address,
        "AccessTime": access_time,          # ddMMyyyyHHmmss
        "CardId": card_id,
        "IssueCount": issue_count,
        "UserName": user_name,
        "UserId": "",
        "UpdateTime": access_time,
        "InOut": "Vào",
        "EventType": 1,                     # NormalAccess
        "IdType": 4,                        # CardType.FaceId -> "Face ID"
        "CornerId": 0,
        "Temperature": temperature,
        "DelayOpenDoorByCamera": 0.0,
        "SendType": 0,
        "ImageFile": "",                    # webhook attaches the photo
        "Distance": 0.0,
        "SearchScore": score,
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
    if not card_id or not access_time:
        return jsonify(ok=False, error="cardId and accessTime are required"), 400
    device_address = data.get("deviceAddress") or DEFAULT_DEVICE_ADDRESS
    score = float(data.get("score") or round(random.uniform(0.80, 0.95), 3))
    temperature = float(data.get("temperature") or round(random.uniform(36.3, 37.1), 1))
    issue_count = int(data.get("issueCount") or 1)
    message = build_event_message(card_id, data.get("userName") or "", access_time,
                                  score, device_address, temperature, issue_count)
    try:
        publish(message, device_address)
    except Exception as e:  # surface broker errors to the caller
        return jsonify(ok=False, error=str(e)), 502
    return jsonify(ok=True, routingKey=f".topic.event.{device_address}",
                   accessTime=access_time, score=score)


@app.route("/health")
def health():
    return jsonify(ok=True, broker=f"{RMQ_HOST}:{RMQ_PORT}", hasPass=bool(RMQ_PASS))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8787")))
