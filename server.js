import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Enable CORS for frontend client
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// System State & Hardware Configuration
const state = {
  isDemoMode: true,
  currentMode: 'MANUAL', // MANUAL | AUTONOMOUS
  activeCommand: 'S',
  motorSpeed: 180,
  lastDriveHeartbeat: Date.now(),
  warningLimit: 400,
  dangerLimit: 1000,
  forwardBlocked: false,
  hardwareConfig: {
    esp32Ip: '',
    esp32CamIp: '',
    piIp: ''
  },
  deviceStatus: {
    esp32: 'DISCONNECTED', // DISCONNECTED | CONNECTED | ERROR
    esp32Cam: 'DISCONNECTED',
    pi: 'DISCONNECTED',
    pressureSensor: 'UNAVAILABLE',
    gasSensor: 'UNAVAILABLE',
    gps: 'UNAVAILABLE'
  },
  lastTelemetry: null,
  eventLogs: []
};

// Log Event Helper
function logEvent(type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    timeStr: new Date().toTimeString().split(' ')[0],
    type, // INFO | SYSTEM | SAFETY | WARN | ERROR
    message
  };
  state.eventLogs.push(logEntry);
  if (state.eventLogs.length > 150) state.eventLogs.shift();

  // Broadcast to all WebSocket clients
  broadcast({ type: 'EVENT_LOG', payload: logEntry });
}

// HTTP Server & WebSocket Setup
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(data) {
  const jsonStr = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonStr);
    }
  });
}

wss.on('connection', (ws) => {
  logEvent('SYSTEM', 'Control Center client connected via WebSocket.');

  // Send initial state upon connection
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    payload: {
      isDemoMode: state.isDemoMode,
      currentMode: state.currentMode,
      activeCommand: state.activeCommand,
      motorSpeed: state.motorSpeed,
      hardwareConfig: state.hardwareConfig,
      deviceStatus: state.deviceStatus,
      lastTelemetry: state.lastTelemetry,
      eventLogs: state.eventLogs.slice(-30)
    }
  }));

  ws.on('message', async (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg.toString());
      await handleClientMessage(ws, msg);
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });
});

function formatUrl(ipOrUrl, defaultPort = '') {
  if (!ipOrUrl) return '';
  let str = ipOrUrl.trim();
  if (!str.startsWith('http://') && !str.startsWith('https://')) {
    str = `http://${str}`;
  }
  try {
    const parsed = new URL(str);
    if (!parsed.port && defaultPort) {
      parsed.port = defaultPort;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (e) {
    return str;
  }
}

// Hardware Command Dispatcher with Acknowledgements
async function sendCommandToHardware(dir, speed) {
  state.activeCommand = dir;
  state.motorSpeed = speed;
  state.lastDriveHeartbeat = Date.now();

  if (state.isDemoMode) {
    return { status: 'ACKNOWLEDGED', dir, speed, source: 'DEMO' };
  }

  if (!state.hardwareConfig.esp32Ip) {
    return { status: 'FAILED', error: 'ESP32 IP NOT CONFIGURED' };
  }

  const baseUrl = formatUrl(state.hardwareConfig.esp32Ip);
  const url = `${baseUrl}/cmd?dir=${encodeURIComponent(dir)}&speed=${encodeURIComponent(speed)}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      state.deviceStatus.esp32 = 'CONNECTED';
      return { status: 'ACKNOWLEDGED', dir, speed, source: 'ESP32' };
    } else {
      state.deviceStatus.esp32 = 'ERROR';
      return { status: 'FAILED', error: `HTTP ${response.status}` };
    }
  } catch (err) {
    state.deviceStatus.esp32 = 'DISCONNECTED';
    return { status: 'FAILED', error: err.name === 'AbortError' ? 'Timeout (1.2s)' : 'Network Error' };
  }
}

// Handle Client WebSocket Actions
async function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'DRIVE_COMMAND': {
      const { dir, speed } = msg.payload;

      // Validate Mode
      if (state.currentMode === 'AUTONOMOUS' && dir !== 'S') {
        ws.send(JSON.stringify({
          type: 'COMMAND_RESPONSE',
          payload: { status: 'REJECTED', dir, error: 'Manual controls locked in Autonomous mode.' }
        }));
        return;
      }

      // Validate Safety Interlock
      if (dir === 'F' && state.forwardBlocked) {
        ws.send(JSON.stringify({
          type: 'COMMAND_RESPONSE',
          payload: { status: 'REJECTED', dir, error: 'FORWARD BLOCKED: Critical gas hazard active!' }
        }));
        return;
      }

      const result = await sendCommandToHardware(dir, speed || state.motorSpeed);
      
      ws.send(JSON.stringify({
        type: 'COMMAND_RESPONSE',
        payload: { ...result, dir, speed }
      }));

      broadcast({
        type: 'STATE_UPDATE',
        payload: { activeCommand: state.activeCommand, motorSpeed: state.motorSpeed }
      });
      break;
    }

    case 'SET_MODE': {
      const { mode } = msg.payload;
      if (state.currentMode === mode) return;

      // Always stop motors first before mode shift
      await sendCommandToHardware('S', 0);
      state.currentMode = mode;

      logEvent('SYSTEM', `Operating Mode switched to ${mode}`);

      // Notify Pi if in live mode
      if (!state.isDemoMode && state.hardwareConfig.piIp) {
        try {
          await fetch(`http://${state.hardwareConfig.piIp}:5000/mode?m=${mode === 'AUTONOMOUS' ? 'auto' : 'manual'}`);
        } catch (e) {
          console.warn('Failed to notify Pi of mode change:', e.message);
        }
      }

      broadcast({ type: 'STATE_UPDATE', payload: { currentMode: state.currentMode } });
      break;
    }

    case 'UPDATE_CONFIG': {
      const { esp32Ip, esp32CamIp, piIp, isDemoMode } = msg.payload;
      state.hardwareConfig = { esp32Ip, esp32CamIp, piIp };
      state.isDemoMode = isDemoMode;

      logEvent('SYSTEM', `Configuration updated. Demo Mode: ${state.isDemoMode ? 'ENABLED' : 'DISABLED'}`);

      broadcast({
        type: 'STATE_UPDATE',
        payload: { hardwareConfig: state.hardwareConfig, isDemoMode: state.isDemoMode }
      });
      break;
    }

    case 'EMERGENCY_STOP': {
      const result = await sendCommandToHardware('S', 0);
      logEvent('SAFETY', 'EMERGENCY STOP TRIGGERED BY OPERATOR.');
      broadcast({ type: 'COMMAND_RESPONSE', payload: { ...result, dir: 'S', isEmergency: true } });
      break;
    }
  }
}

// IPv4 Regex pattern helper
function isValidIpv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  if (trimmed === 'localhost' || trimmed === '127.0.0.1') return true;
  const ipv4Pattern = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.){3}(25[0-5]|(2[0-4]|1\d|[1-9]|)\d)$/;
  return ipv4Pattern.test(trimmed);
}

// Attempt real hardware connection probe against target IP (parallel probe with 2.5s max timeout)
async function testRoverConnection(ip) {
  const cleanIp = ip.trim();
  const probeEndpoints = [
    `http://${cleanIp}:5001/data`,
    `http://${cleanIp}:5000/data`,
    `http://${cleanIp}:8080/ping`,
    `http://${cleanIp}:80/ping`,
    `http://${cleanIp}/ping`,
    `http://${cleanIp}:5000/api/status`
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  const fetchPromises = probeEndpoints.map(async (endpoint) => {
    try {
      const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
      if (response.ok) {
        return { ok: true, endpoint };
      }
    } catch (e) {}
    throw new Error('Unreachable');
  });

  try {
    const result = await Promise.any(fetchPromises);
    clearTimeout(timeout);
    return result;
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false };
  }
}

// REST API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    isDemoMode: state.isDemoMode,
    currentMode: state.currentMode,
    activeCommand: state.activeCommand,
    deviceStatus: state.deviceStatus,
    hardwareConfig: state.hardwareConfig
  });
});

app.post('/api/command', async (req, res) => {
  const { dir, speed } = req.body;
  if (!dir) return res.status(400).json({ error: 'Missing dir' });
  const result = await sendCommandToHardware(dir, speed || state.motorSpeed);
  res.json(result);
});

app.post('/api/config', (req, res) => {
  const { esp32Ip, esp32CamIp, piIp, isDemoMode } = req.body;
  state.hardwareConfig = { esp32Ip, esp32CamIp, piIp };
  if (typeof isDemoMode === 'boolean') state.isDemoMode = isDemoMode;
  res.json({ status: 'OK', hardwareConfig: state.hardwareConfig, isDemoMode: state.isDemoMode });
});

app.post('/api/connect-rover', async (req, res) => {
  const { ip } = req.body;
  
  if (!ip || !isValidIpv4(ip)) {
    return res.status(400).json({
      success: false,
      error: 'Enter a valid local IP address.'
    });
  }

  const cleanIp = ip.trim();
  logEvent('SYSTEM', `Attempting hardware connection to local rover IP: ${cleanIp}...`);

  const connectionResult = await testRoverConnection(cleanIp);

  if (connectionResult.ok) {
    state.activeCommand = 'S';
    state.lastDriveHeartbeat = Date.now();
    state.isDemoMode = false;
    state.hardwareConfig = {
      esp32Ip: `${cleanIp}:8080`,
      piIp: `${cleanIp}:5001`,
      esp32CamIp: `${cleanIp}:81`,
      roverIp: cleanIp
    };
    state.deviceStatus = {
      esp32: 'CONNECTED',
      esp32Cam: 'CONNECTED',
      pi: 'CONNECTED',
      pressureSensor: 'ACTIVE',
      gasSensor: 'ACTIVE',
      gps: 'ACTIVE'
    };

    logEvent('SYSTEM', `● Physical Rover connected at ${cleanIp}. Live data active.`);

    broadcast({
      type: 'STATE_UPDATE',
      payload: {
        isDemoMode: false,
        hardwareConfig: state.hardwareConfig,
        deviceStatus: state.deviceStatus
      }
    });

    return res.json({
      success: true,
      ip: cleanIp,
      message: `Rover connected at ${cleanIp}`
    });
  } else {
    logEvent('WARN', `Rover connection failed. Unable to connect to ${cleanIp}.`);
    return res.status(408).json({
      success: false,
      ip: cleanIp,
      error: `Unable to connect to ${cleanIp}`
    });
  }
});

app.post('/api/disconnect-rover', (req, res) => {
  const previousIp = state.hardwareConfig.roverIp || 'Rover';
  state.isDemoMode = true;
  state.hardwareConfig = { esp32Ip: '', esp32CamIp: '', piIp: '', roverIp: '' };
  state.activeCommand = 'S';

  logEvent('SYSTEM', `Disconnected from ${previousIp}. Switched to Demo Mode.`);

  broadcast({
    type: 'STATE_UPDATE',
    payload: {
      isDemoMode: true,
      hardwareConfig: state.hardwareConfig,
      deviceStatus: state.deviceStatus
    }
  });

  res.json({ success: true, message: 'Disconnected from rover. Switched to Demo Mode.' });
});

// Telemetry Polling & Simulation Loops
let simPpm = 245;
let simPressure = 101.3;

function generateSimulatedTelemetry() {
  const delta = (Math.random() - 0.48) * 6;
  simPpm = Math.max(90, Math.min(1250, Math.round(simPpm + delta)));
  
  const pressDelta = (Math.random() - 0.5) * 0.05;
  simPressure = parseFloat(Math.max(98.5, Math.min(104.2, simPressure + pressDelta)).toFixed(1));

  return {
    timestamp: new Date().toISOString(),
    isDemoMode: true,
    gas: simPpm,
    gas_raw: Math.round(simPpm * 48.2 + Math.random() * 20),
    gas_alarm: simPpm >= state.warningLimit,
    pressure: simPressure,
    pressure_status: 'Normal',
    temp: 34,
    battery: 88,
    mode: state.currentMode,
    speed: state.motorSpeed,
    lat: 28.6139,
    lng: 77.2090,
    cpu: 24,
    uptime: '01:42:15',
    objects: ['PERSON', 'OIL SPILL']
  };
}

async function fetchLiveTelemetry() {
  if (!state.hardwareConfig.piIp) {
    state.deviceStatus.pi = 'DISCONNECTED';
    state.deviceStatus.pressureSensor = 'UNAVAILABLE';
    state.deviceStatus.gasSensor = 'UNAVAILABLE';
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const baseUrl = formatUrl(state.hardwareConfig.piIp, '5000');
    const res = await fetch(`${baseUrl}/data`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      state.deviceStatus.pi = 'CONNECTED';
      state.deviceStatus.pressureSensor = typeof data.pressure === 'number' ? 'ACTIVE' : 'UNAVAILABLE';
      state.deviceStatus.gasSensor = typeof data.gas === 'number' ? 'ACTIVE' : 'UNAVAILABLE';
      state.deviceStatus.gps = (data.lat && data.lng) ? 'ACTIVE' : 'NO SIGNAL';

      return {
        ...data,
        timestamp: new Date().toISOString(),
        isDemoMode: false
      };
    } else {
      state.deviceStatus.pi = 'ERROR';
    }
  } catch (err) {
    console.warn('[Telemetry Fetch Error]:', err.message);
    state.deviceStatus.pi = 'DISCONNECTED';
    state.deviceStatus.pressureSensor = 'UNAVAILABLE';
    state.deviceStatus.gasSensor = 'UNAVAILABLE';
    state.deviceStatus.gps = 'UNAVAILABLE';
  }
  return null;
}

// Telemetry Broadcast Loop (1 Hz)
setInterval(async () => {
  let telemetryPayload = null;

  if (state.isDemoMode) {
    state.deviceStatus.esp32 = 'CONNECTED';
    state.deviceStatus.esp32Cam = 'CONNECTED';
    state.deviceStatus.pi = 'CONNECTED';
    state.deviceStatus.pressureSensor = 'ACTIVE';
    state.deviceStatus.gasSensor = 'ACTIVE';
    state.deviceStatus.gps = 'ACTIVE';
    telemetryPayload = generateSimulatedTelemetry();
  } else {
    telemetryPayload = await fetchLiveTelemetry();
  }

  state.lastTelemetry = telemetryPayload;

  // Evaluate Hazard Thresholds
  if (telemetryPayload && typeof telemetryPayload.gas === 'number') {
    if (telemetryPayload.gas >= state.dangerLimit) {
      if (!state.forwardBlocked) {
        state.forwardBlocked = true;
        logEvent('SAFETY', `✖ DANGER: Gas levels ${telemetryPayload.gas} ppm exceed Danger Limit (${state.dangerLimit} ppm). Forward movement locked.`);
        if (state.activeCommand === 'F') {
          sendCommandToHardware('S', 0);
        }
      }
    } else {
      if (state.forwardBlocked) {
        state.forwardBlocked = false;
        logEvent('INFO', `Gas levels (${telemetryPayload.gas} ppm) clear of danger threshold. Forward movement unlocked.`);
      }
    }
  }

  broadcast({
    type: 'TELEMETRY_UPDATE',
    payload: {
      telemetry: telemetryPayload,
      deviceStatus: state.deviceStatus,
      forwardBlocked: state.forwardBlocked
    }
  });
}, 1000);

// Hardware Watchdog Loop (Checks every 300ms)
setInterval(() => {
  if (state.activeCommand !== 'S') {
    const elapsed = Date.now() - state.lastDriveHeartbeat;
    if (elapsed > 1200) {
      console.warn(`[WATCHDOG] Command heartbeat timeout (${elapsed}ms). Triggering safety stop.`);
      sendCommandToHardware('S', 0);
      logEvent('SAFETY', `✖ WATCHDOG INTERLOCK: Controller heartbeat timeout (${elapsed}ms). Rover stopped.`);
      broadcast({
        type: 'WATCHDOG_TRIGGERED',
        payload: { reason: 'Heartbeat timeout', elapsedMs: elapsed }
      });
    }
  }
}, 300);

// Start HTTP Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` ARGUS Rover Hardware Backend Server running on port ${PORT}`);
  console.log(` WebSocket Endpoint: ws://localhost:${PORT}/ws`);
  console.log(`=======================================================`);
});
