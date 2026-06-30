// --- 1. Global State Configuration ---
const wsUrl = "wss://p2pchat-jzgk.onrender.com";
let socket;
let yourId = null;
let peerId = null;

let peerConnection;
let dataChannel;

// WebRTC configurations with a public Google STUN server to discover network paths
const rtcConfig = {
  iceServers: [
    {
      urls: ["stun:stun3.l.google.com:19302"],
    },
  ],
};

const yourIdInput = document.getElementById("yourId");
const peerIdInput = document.getElementById("peerId");
const connectButton = document.getElementById("connect");
const chatboxDiv = document.getElementById("chatboxContainer");
const statusText = document.getElementById("statusText");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("sendMessage");

const isSixDigits = (str) => {
  return /^\d{6}$/.test(str);
};

// --- 2. Initialize Signaling Server Connection ---
function initSignaling() {
  socket = new WebSocket(wsUrl);

  socket.onopen = () => console.log("Connected to signaling server");

  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    console.log(message);
    switch (message.type) {
      case "assigned-id":
        yourId = message.yourId;
        yourIdInput.value = yourId;
        connectButton.disabled = false;
        break;

      case "signal":
        // Save who is trying to contact us
        peerId = message.senderId;
        await handleIncomingSignal(message.payload);
        break;

      case "error":
        alert(`Server Error: ${message.message}`);
        break;
    }
  };

  socket.onclose = () => {
    yourIdInput.value = "Disconnected";
    statusText.textContent = "Status: Signaling server disconnected.";
  };
}

// --- 3. Initialize WebRTC PeerConnection & Event Listeners ---
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Send local network path candidates to the server to relay to the peer
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && peerId) {
      socket.send(
        JSON.stringify({
          targetId: peerId,
          payload: { type: "candidate", candidate: event.candidate },
        }),
      );
    }
  };

  // Monitor the state of the peer connection
  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection State: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === "connected") {
      statusText.textContent = `Status: Directly connected to ${peerId}`;
    }
  };
}

// --- 4. Setup Data Channel Events ---
function setupDataChannelListeners() {
  dataChannel.onopen = () => {
    messageInput.disabled = false;
    sendButton.disabled = false;
    statusText.textContent = `Status: Direct Data Channel Open!`;
  };

  dataChannel.onclose = () => {
    messageInput.disabled = true;
    sendButton.disabled = true;
    statusText.textContent = `Status: Disconnected from peer.`;
  };

  dataChannel.onmessage = (event) => {
    appendMessage(`Peer: ${event.data}`, "blue");
  };
}

// --- 5. User 1: Initiating Connection (Clicking Connect Button) ---
connectButton.addEventListener("click", async () => {
  peerId = peerIdInput.value.trim();
  if (!peerId || peerId.length !== 6) {
    alert("Please enter a valid 6-digit ID");
    return;
  }

  statusText.textContent = "Status: Connecting...";
  createPeerConnection();

  // User 1 creates the data channel first
  dataChannel = peerConnection.createDataChannel("chatChannel");
  setupDataChannelListeners();

  // Create Offer SDP and set it locally
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Send Offer SDP to User 2 via Signaling Server
  socket.send(
    JSON.stringify({
      targetId: peerId,
      payload: { type: "offer", sdp: peerConnection.localDescription },
    }),
  );
});

// --- 6. User 2 & General Handshake Signal Handling ---
async function handleIncomingSignal(payload) {
  // Lazy-initialize connection for the receiver (User 2)
  if (!peerConnection) {
    createPeerConnection();

    // User 2 catches User 1's data channel when it arrives
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannelListeners();
    };
  }

  if (payload.type === "offer") {
    // Set the received offer string configuration
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(payload.sdp),
    );

    // Create Answer SDP and set it locally
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send Answer SDP back to User 1 via Signaling Server
    socket.send(
      JSON.stringify({
        targetId: peerId,
        payload: { type: "answer", sdp: peerConnection.localDescription },
      }),
    );
  } else if (payload.type === "answer") {
    // User 1 receives User 2's answer string configuration
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(payload.sdp),
    );
  } else if (payload.type === "candidate") {
    // Add trickle ICE network options to the connection
    try {
      await peerConnection.addIceCandidate(
        new RTCIceCandidate(payload.candidate),
      );
    } catch (e) {
      console.error("Error adding received ice candidate", e);
    }
  }
}

// --- 7. Direct P2P UI Interactions ---
sendButton.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !dataChannel || dataChannel.readyState !== "open") return;

  // Send message directly to the peer browser (bypasses Node.js server)
  dataChannel.send(text);
  appendMessage(`You: ${text}`, "black");
  messageInput.value = "";
}

function appendMessage(msg, color) {
  const p = document.createElement("p");
  p.textContent = msg;
  p.style.color = color;
  chatboxDiv.appendChild(p);
  chatboxDiv.scrollTop = chatboxDiv.scrollHeight;
}

// Run application setup
initSignaling();
