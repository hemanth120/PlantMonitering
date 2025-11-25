
// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const mqtt = require("mqtt");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Socket.IO – allow any origin during development
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// ---------- MQTT SETUP ----------
// ---------- CONFIG FROM ENV ----------

// e.g. mqtt://35.203.58.201
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://35.203.58.201";

const MQTT_USERNAME = process.env.MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "";

// For CORS / Socket.IO
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

// Port (Render will set PORT automatically)
const PORT = process.env.PORT || 4000;

// ---------- MQTT SETUP ----------
const mqttOptions = {
  username: MQTT_USERNAME || undefined,
  password: MQTT_PASSWORD || undefined,
};

const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);



// latest telemetry snapshot
const latestTelemetry = {
  temperature: null,
  humidity: null,
  pressure: null,
  altitude: null,
  soilMoisture: null,
};

mqttClient.on("connect", () => {
  console.log("✅ Connected to MQTT Broker");

  mqttClient.subscribe("esp32/#", (err) => {
    if (err) {
      console.error("Error subscribing to esp32/#:", err);
    } else {
      console.log("📡 Subscribed to esp32/#");
    }
  });
});

mqttClient.on("error", (err) => {
  console.error("MQTT error:", err);
});

// On ANY MQTT message from ESP32, update relevant field and emit
mqttClient.on("message", (topic, messageBuffer) => {
  const msg = messageBuffer.toString();
  console.log(`📥 MQTT message on ${topic}: ${msg}`);

  try {
    switch (topic) {
      case "esp32/dht/temp": {
        const v = parseFloat(msg);
        if (!isNaN(v)) latestTelemetry.temperature = v;
        break;
      }
      case "esp32/dht/hum": {
        const v = parseFloat(msg);
        if (!isNaN(v)) latestTelemetry.humidity = v;
        break;
      }
      case "esp32/bmp/press": {
        const v = parseFloat(msg);
        if (!isNaN(v)) latestTelemetry.pressure = v;
        break;
      }
      case "esp32/bmp/alt": {
        const v = parseFloat(msg);
        if (!isNaN(v)) latestTelemetry.altitude = v;
        break;
      }
      case "esp32/soil": {
        const raw = parseFloat(msg);
        if (!isNaN(raw)) {
         let percent = Math.round(((4095 - raw) / 4095) * 100);

          if (percent < 0) percent = 0;
          if (percent > 100) percent = 100;
          latestTelemetry.soilMoisture = percent;
        }
        break;
      }
      default:
        // ignore other topics like esp32/bmp/temp if you don't need it
        break;
    }

    // 👉 ALWAYS emit after processing a sensor message
    io.emit("telemetry", latestTelemetry);
    console.log("📡 Emitted telemetry:", latestTelemetry);
  } catch (err) {
    console.error("Error handling MQTT message:", err);
  }
});

// ---------- REST API ----------
app.get("/", (req, res) => {
  res.send("MQTT backend up and running");
});

app.get("/api/telemetry", (req, res) => {
  res.json(latestTelemetry);
});

// Pump ON/OFF from frontend
app.post("/api/control", (req, res) => {
  const { pumpOn } = req.body;

  if (typeof pumpOn !== "boolean") {
    return res.status(400).json({ error: "pumpOn must be boolean" });
  }

  const payload = pumpOn ? "ON" : "OFF";

  mqttClient.publish("esp32/motor", payload, { qos: 1 }, (err) => {
    if (err) {
      console.error("Error publishing control message:", err);
      return res.status(500).json({ error: "Failed to publish MQTT message" });
    }

    console.log("📤 Published control to esp32/motor:", payload);
    res.json({ success: true });
  });
});

// ---------- SOCKET.IO ----------
io.on("connection", (socket) => {
  console.log("🔌 Web client connected:", socket.id);

  // Send current data snapshot immediately
  socket.emit("telemetry", latestTelemetry);

  socket.on("disconnect", () => {
    console.log("❌ Web client disconnected:", socket.id);
  });
});

// ---------- START SERVER ----------

server.listen(PORT, () => {
  console.log(`🚀 Backend listening on http://localhost:${PORT}`);
});
