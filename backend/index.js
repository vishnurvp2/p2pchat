import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

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

console.log("ID-based Signaling Server running... ");
