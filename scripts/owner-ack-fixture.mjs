// Synthetic test instrumentation. Record ACKs without changing their delivery.
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const send = WebSocket.prototype.send;
WebSocket.prototype.send = function (data, ...args) {
  if (typeof data === "string") {
    const frame = JSON.parse(data);
    if (frame.type === "ack") writeFileSync(process.env.OWNER_ACK_FILE, frame.id, { mode: 0o600 });
  }
  return send.call(this, data, ...args);
};
