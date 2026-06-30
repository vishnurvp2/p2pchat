// --- 1. Global State Configuration ---
const wsUrl = "wss://p2pchat-jzgk.onrender.com";

let socket;
let yourId = null;
let peerId = null;

let peerConnection = null;
let dataChannel = null;

let pendingIceCandidates = [];
let connectionTimeout = null;

// WebRTC configurations with public Google STUN servers
const rtcConfig = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
      ],
    },
  ],
};

const CONNECTION_TIMEOUT_MS = 30000;

const yourIdInput = document.getElementById("yourId");
const peerIdInput = document.getElementById("peerId");
const connectButton = document.getElementById("connect");
const chatboxDiv = document.getElementById("chatboxContainer");
const statusText = document.getElementById("statusText");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("sendMessage");

const isSixDigits = (str) => /^\d{6}$/.test(str);

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

function startConnectionTimeout() {
  clearConnectionTimeout();

  connectionTimeout = setTimeout(() => {
    if (peerConnection && peerConnection.connectionState !== "connected") {
      console.warn("Connection timed out.");

      statusText.textContent = "Status: Connection timed out.";

      cleanupPeerConnection();
    }
  }, CONNECTION_TIMEOUT_MS);
}

function clearConnectionTimeout() {
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }
}

function cleanupPeerConnection() {
  clearConnectionTimeout();

  pendingIceCandidates = [];

  if (dataChannel) {
    try {
      dataChannel.onopen = null;
      dataChannel.onclose = null;
      dataChannel.onmessage = null;

      if (dataChannel.readyState !== "closed") {
        dataChannel.close();
      }
    } catch (e) {
      console.warn(e);
    }

    dataChannel = null;
  }

  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.onicegatheringstatechange = null;
      peerConnection.ondatachannel = null;

      peerConnection.close();
    } catch (e) {
      console.warn(e);
    }

    peerConnection = null;
  }

  messageInput.disabled = true;
  sendButton.disabled = true;
}

async function flushPendingIceCandidates() {
  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error("Failed to add queued ICE candidate:", e);
    }
  }
}

// -----------------------------------------------------------------------------
// 2. Initialize Signaling Server Connection
// -----------------------------------------------------------------------------

function initSignaling() {
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("Connected to signaling server");
    statusText.textContent = "Status: Connected to signaling server.";
  };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log(message);

      switch (message.type) {
        case "assigned-id":
          yourId = message.yourId;
          yourIdInput.value = yourId;
          connectButton.disabled = false;
          break;

        case "signal":
          peerId = message.senderId;
          await handleIncomingSignal(message.payload);
          break;

        case "error":
          alert(`Server Error: ${message.message}`);
          break;

        default:
          console.warn("Unknown message:", message);
      }
    } catch (e) {
      console.error("Invalid signaling message:", e);
    }
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };

  socket.onclose = () => {
    console.log("Disconnected from signaling server");

    cleanupPeerConnection();

    yourIdInput.value = "Disconnected";
    statusText.textContent = "Status: Signaling server disconnected.";
  };
}

// -----------------------------------------------------------------------------
// 3. Initialize Peer Connection
// -----------------------------------------------------------------------------

function createPeerConnection() {
  cleanupPeerConnection();

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      console.log("ICE gathering complete.");
      return;
    }

    console.log("Local ICE Candidate:", event.candidate);

    if (socket && socket.readyState === WebSocket.OPEN && peerId) {
      socket.send(
        JSON.stringify({
          targetId: peerId,
          payload: {
            type: "candidate",
            candidate: event.candidate,
          },
        }),
      );
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("Connection State:", peerConnection.connectionState);

    switch (peerConnection.connectionState) {
      case "connected":
        clearConnectionTimeout();
        statusText.textContent = "Status: Direct connection established.";
        break;

      case "failed":
        statusText.textContent = "Status: Connection failed.";
        cleanupPeerConnection();
        break;

      case "disconnected":
        statusText.textContent = "Status: Peer disconnected.";
        break;

      case "closed":
        statusText.textContent = "Status: Connection closed.";
        break;
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", peerConnection.iceConnectionState);
  };

  peerConnection.onicegatheringstatechange = () => {
    console.log("ICE Gathering State:", peerConnection.iceGatheringState);
  };

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannelListeners();
  };
}

// -----------------------------------------------------------------------------
// 4. Data Channel
// -----------------------------------------------------------------------------

function setupDataChannelListeners() {
  if (!dataChannel) return;

  dataChannel.onopen = () => {
    console.log("Data channel opened.");

    messageInput.disabled = false;
    sendButton.disabled = false;

    statusText.textContent = "Status: Direct Data Channel Open!";
  };

  dataChannel.onclose = () => {
    console.log("Data channel closed.");

    messageInput.disabled = true;
    sendButton.disabled = true;

    statusText.textContent = "Status: Disconnected from peer.";
  };

  dataChannel.onmessage = (event) => {
    appendMessage(`Peer: ${event.data}`, "blue");
  };
}

// -----------------------------------------------------------------------------
// 5. Initiate Connection
// -----------------------------------------------------------------------------

connectButton.addEventListener("click", async () => {
  try {
    peerId = peerIdInput.value.trim();

    if (!isSixDigits(peerId)) {
      alert("Please enter a valid 6-digit ID.");
      return;
    }

    if (peerId === yourId) {
      alert("You cannot connect to yourself.");
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("Signaling server is not connected.");
      return;
    }

    statusText.textContent = "Status: Connecting...";

    createPeerConnection();

    startConnectionTimeout();

    dataChannel = peerConnection.createDataChannel("chatChannel");

    setupDataChannelListeners();

    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    socket.send(
      JSON.stringify({
        targetId: peerId,
        payload: {
          type: "offer",
          sdp: peerConnection.localDescription,
        },
      }),
    );
  } catch (e) {
    console.error(e);
    alert("Failed to start connection.");
    cleanupPeerConnection();
  }
});

// -----------------------------------------------------------------------------
// 6. Signaling
// -----------------------------------------------------------------------------

async function handleIncomingSignal(payload) {
  try {
    if (!peerConnection) {
      createPeerConnection();
      startConnectionTimeout();
    }

    switch (payload.type) {
      case "offer":
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(payload.sdp),
        );

        await flushPendingIceCandidates();

        const answer = await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(answer);

        socket.send(
          JSON.stringify({
            targetId: peerId,
            payload: {
              type: "answer",
              sdp: peerConnection.localDescription,
            },
          }),
        );

        break;

      case "answer":
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(payload.sdp),
        );

        await flushPendingIceCandidates();

        break;

      case "candidate":
        if (
          peerConnection.remoteDescription &&
          peerConnection.remoteDescription.type
        ) {
          await peerConnection.addIceCandidate(
            new RTCIceCandidate(payload.candidate),
          );
        } else {
          pendingIceCandidates.push(payload.candidate);
        }
        break;

      default:
        console.warn("Unknown signaling payload:", payload);
    }
  } catch (e) {
    console.error("Error handling signaling message:", e);
  }
}

// -----------------------------------------------------------------------------
// 7. Chat
// -----------------------------------------------------------------------------

sendButton.addEventListener("click", sendMessage);

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

function sendMessage() {
  const text = messageInput.value.trim();

  if (!text) return;

  if (!dataChannel || dataChannel.readyState !== "open") {
    alert("Peer is not connected.");
    return;
  }

  try {
    dataChannel.send(text);

    appendMessage(`You: ${text}`, "black");

    messageInput.value = "";
  } catch (e) {
    console.error("Failed to send message:", e);
  }
}

function appendMessage(msg, color) {
  const p = document.createElement("p");

  p.textContent = msg;
  p.style.color = color;

  chatboxDiv.appendChild(p);
  chatboxDiv.scrollTop = chatboxDiv.scrollHeight;
}

// -----------------------------------------------------------------------------
// Start Application
// -----------------------------------------------------------------------------

initSignaling();
