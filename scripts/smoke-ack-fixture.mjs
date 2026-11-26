// Loaded only by the synthetic smoke runner. Interrupt the real adapter precisely
// when it asks ws to transmit an ACK, after it has synced the local inbox.
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const send = WebSocket.prototype.send;
WebSocket.prototype.send = function (data, ...args) {
  if (typeof data === "string") {
    const frame = JSON.parse(data);
    if (frame.type === "ack" && frame.id === process.env.SMOKE_MESSAGE_ID) {
      writeFileSync(process.env.SMOKE_ACK_MARKER, frame.id, { mode: 0o600 });
      if (process.env.SMOKE_INTERRUPT === "yes") process.exit(73);
    }
  }
  return send.call(this, data, ...args);
};
