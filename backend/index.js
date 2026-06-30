import http from "http";
import { WebSocketServer } from "ws";

// A native HTTP server to satisfy Render's HTTP routing proxy
const server = http.createServer((req, res) => {
  // Returns a friendly status check message if visited in a browser via https://
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Signaling Server is Alive and Healthy!");
});

const wss = new WebSocketServer({
  noServer: true, // We will manually handle the connection upgrade
});

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "https://vishnurvp2.github.io/p2pchat",
];

// 3. Intercept HTTP Upgrade requests manually
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;

  if (!allowedOrigins.includes(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Hand over the network socket directly to ws
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Active clients map: { "123456": socketInstance }
const clients = new Map();

// Helper to generate a unique 6-digit ID
function generateUniqueId() {
  let id;
  do {
    id = Math.floor(100000 + Math.random() * 900000).toString();
  } while (clients.has(id)); // Ensure ID isn't already taken
  return id;
}

wss.on("connection", (socket) => {
  // 1. Assign and store the unique 6-digit ID
  const myId = generateUniqueId();
  clients.set(myId, socket);
  console.log(`User connected. Assigned ID: ${myId}`);

  // 2. Immediately inform the user what their ID is
  socket.send(
    JSON.stringify({
      type: "assigned-id",
      yourId: myId,
    }),
  );

  // 3. Handle incoming messages
  socket.on("message", (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());
      const targetId = data.targetId;

      if (!targetId) {
        socket.send(
          JSON.stringify({ type: "error", message: "Missing targetId" }),
        );
        return;
      }

      const targetSocket = clients.get(targetId);

      // 4. Relay the message if the target user is online
      if (targetSocket && targetSocket.readyState === socket.OPEN) {
        targetSocket.send(
          JSON.stringify({
            type: "signal",
            senderId: myId, // Let the receiver know who sent it
            payload: data.payload, // The WebRTC SDP or ICE candidate
          }),
        );
      } else {
        socket.send(
          JSON.stringify({
            type: "error",
            message: `User ${targetId} is offline or does not exist.`,
          }),
        );
      }
    } catch (err) {
      console.error("Invalid message format received");
    }
  });

  // 5. Clean up on disconnect
  socket.on("close", () => {
    clients.delete(myId);
    console.log(`User ${myId} disconnected.`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening natively on port ${PORT}`);
});
