/**
 * ARGUS Rover Control Center
 * Real-time Robotics Command Console, Dual Video Stream Handler,
 * Sensor Telemetry, Fail-Safe Interlocks & Data Visualization.
 */

// 1. Robot Configuration Object
const CONFIG = {
  esp32: {
    base: "",
    ping: "/ping",
    command: "/cmd"
  },
  esp32Cam: {
    stream: ""
  },
  pi: {
    base: "",
    video: "/video_feed",
    data: "/data",
    mode: "/mode"
  }
};

class ArgusController {
  constructor() {
    // Mode & Simulation
    this.isDemoMode = true;
    this.currentMode = 'MANUAL'; // 'MANUAL' or 'AUTONOMOUS'
    this.activeCommand = 'S';
    this.motorSpeed = 180;
    this.heartbeatTimer = null;
    this.pingTimer = null;
    this.telemetryTimer = null;

    // Safety & Limits
    this.warningLimit = 400;
    this.dangerLimit = 1000;
    this.autoStopOnDanger = true;
    this.soundAlarmEnabled = true;
    this.inDangerState = false;
    this.forwardBlocked = false;

    // Sensor Readings & History
    this.currentGas = 245;
    this.currentGasRaw = 11820;
    this.peakGas = 245;
    this.currentPressure = 101.3;
    this.alarmPin = 'CLEAR';
    this.sensorReady = true;
    this.detectedObjects = ['PERSON', 'OIL SPILL'];
    this.gasHistory = []; // array of { time: Date, ppm: number, raw: number, alarm: string }

    // Audio Context for Web Audio API Warning Beep
    this.audioCtx = null;

    // Active Keyboard Keys Set & Emergency Stop Latch
    this.pressedKeys = new Set();
    this.emergencyStopLatched = false;

    // Connected Hardware IP
    this.connectedRoverIp = '';

    // Canvas references
    this.chartCanvas = document.getElementById('gasChartCanvas');
    this.chartTooltip = document.getElementById('gasTooltip');
    this.cam1Canvas = document.getElementById('cam1Canvas');
    this.cam2Canvas = document.getElementById('cam2Canvas');

    this.init();
  }

  init() {
    this.initMobileNav();
    this.loadPersistedSettings();
    this.bindUiEvents();
    this.setupKeyboardControls();
    this.setupBrowserSafety();
    this.setupChartInteraction();
    this.checkHttpsNotice();
    this.initLeafletMap();
    this.initWebSocketConnection();
    this.initAddRoverFlow();

    // Seed Initial Gas History (Last 60 seconds)
    const now = Date.now();
    for (let i = 59; i >= 0; i--) {
      const ppm = Math.max(80, Math.min(600, Math.round(230 + Math.sin(i * 0.15) * 40 + (Math.random() * 20 - 10))));
      this.gasHistory.push({
        time: new Date(now - i * 1000),
        ppm: ppm,
        raw: Math.round(ppm * 48.2 + 100),
        alarm: 'CLEAR'
      });
    }
    this.renderGasChart();

    this.logEvent('INFO', 'ARGUS Control Center initialized.');
    if (this.isDemoMode) {
      this.logEvent('SYSTEM', 'Running in DEMO MODE &mdash; simulated robot data active.');
    } else {
      this.logEvent('SYSTEM', 'Connecting to hardware IP addresses...');
      this.connectHardware();
    }
  }

  /* ------------------------------------------------------------- */
  /* Mobile Navigation Support                                     */
  /* ------------------------------------------------------------- */
  initMobileNav() {
    const menuBtn = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');

    if (menuBtn && navLinks) {
      menuBtn.addEventListener('click', () => {
        const isOpen = navLinks.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', isOpen);
      });

      navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          navLinks.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  /* ------------------------------------------------------------- */
  /* Local Storage & Config Persistence                           */
  /* ------------------------------------------------------------- */
  loadPersistedSettings() {
    try {
      const savedEsp32 = localStorage.getItem('argus_esp32_ip') || '';
      const savedCam = localStorage.getItem('argus_esp32cam_ip') || '';
      const savedPi = localStorage.getItem('argus_pi_ip') || '';

      const esp32Input = document.getElementById('esp32IpInput');
      const camInput = document.getElementById('esp32CamIpInput');
      const piInput = document.getElementById('piIpInput');

      if (esp32Input) esp32Input.value = savedEsp32;
      if (camInput) camInput.value = savedCam;
      if (piInput) piInput.value = savedPi;

      // Thresholds
      const savedWarn = localStorage.getItem('argus_warning_limit');
      const savedDanger = localStorage.getItem('argus_danger_limit');
      if (savedWarn) {
        this.warningLimit = parseInt(savedWarn, 10) || 400;
        const wInput = document.getElementById('warningLimitInput');
        if (wInput) wInput.value = this.warningLimit;
      }
      if (savedDanger) {
        this.dangerLimit = parseInt(savedDanger, 10) || 1000;
        const dInput = document.getElementById('dangerLimitInput');
        if (dInput) dInput.value = this.dangerLimit;
      }

      // Safety switches
      const savedAutoStop = localStorage.getItem('argus_auto_stop');
      const savedSound = localStorage.getItem('argus_sound_alarm');
      if (savedAutoStop !== null) {
        this.autoStopOnDanger = savedAutoStop === 'true';
        const el = document.getElementById('autoStopToggle');
        if (el) el.checked = this.autoStopOnDanger;
      }
      if (savedSound !== null) {
        this.soundAlarmEnabled = savedSound === 'true';
        const el = document.getElementById('soundAlarmToggle');
        if (el) el.checked = this.soundAlarmEnabled;
      }

      // Check if IPs exist
      if (savedEsp32 || savedCam || savedPi) {
        this.updateConfigUrls(savedEsp32, savedCam, savedPi);
        this.isDemoMode = false;
        this.updateDemoUi(false);
      } else {
        this.isDemoMode = true;
        this.updateDemoUi(true);
      }
    } catch (e) {
      console.warn('localStorage access failed:', e);
      this.isDemoMode = true;
      this.updateDemoUi(true);
    }
  }

  saveSettings() {
    try {
      const esp32 = document.getElementById('esp32IpInput')?.value.trim() || '';
      const cam = document.getElementById('esp32CamIpInput')?.value.trim() || '';
      const pi = document.getElementById('piIpInput')?.value.trim() || '';

      localStorage.setItem('argus_esp32_ip', esp32);
      localStorage.setItem('argus_esp32cam_ip', cam);
      localStorage.setItem('argus_pi_ip', pi);
      localStorage.setItem('argus_warning_limit', this.warningLimit.toString());
      localStorage.setItem('argus_danger_limit', this.dangerLimit.toString());
      localStorage.setItem('argus_auto_stop', this.autoStopOnDanger.toString());
      localStorage.setItem('argus_sound_alarm', this.soundAlarmEnabled.toString());
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }
  }

  updateConfigUrls(esp32, cam, pi) {
    CONFIG.esp32.base = esp32 ? `http://${esp32}` : '';
    CONFIG.esp32Cam.stream = cam ? `http://${cam}:81/stream` : '';
    CONFIG.pi.base = pi ? `http://${pi}:5000` : '';
  }

  updateDemoUi(isDemo) {
    const banner = document.getElementById('demoModeBanner');
    const badgeDot = document.getElementById('demoBadgeDot');
    const badgeText = document.getElementById('demoBadgeText');
    const btnText = document.getElementById('btnAddRoverBtnText');

    if (banner) banner.style.display = 'flex';

    if (isDemo) {
      if (badgeDot) badgeDot.className = 'badge-dot demo';
      if (badgeText) badgeText.innerHTML = 'Demo Mode &bull; Simulated Data Active';
      if (btnText) btnText.textContent = '+ Add your own rover';
    } else {
      if (badgeDot) badgeDot.className = 'badge-dot connected';
      const roverIp = this.connectedRoverIp || 'Physical Hardware';
      if (badgeText) badgeText.innerHTML = '● Rover Connected &bull; Live Data';
      if (btnText) btnText.textContent = `Rover: ${roverIp}`;
    }
    this.checkHttpsNotice();
  }

  initAddRoverFlow() {
    const modal = document.getElementById('roverConnectModal');
    const openBtn = document.getElementById('btnAddRoverBtn');
    const closeBtn = document.getElementById('modalCloseBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const form = document.getElementById('roverConnectForm');
    const ipInput = document.getElementById('roverIpInput');
    const connectBtn = document.getElementById('modalConnectBtn');
    const connectBtnText = document.getElementById('modalConnectBtnText');
    const statusMsg = document.getElementById('modalStatusMsg');
    const formFields = document.getElementById('connectFormFields');
    const connectedView = document.getElementById('connectedDetailsView');
    const disconnectBtn = document.getElementById('modalDisconnectBtn');
    const modalTitle = document.getElementById('modalTitle');
    const modalSubtitle = document.getElementById('modalSubtitle');
    const connectedIpText = document.getElementById('modalConnectedIpText');

    if (!modal || !openBtn) return;

    const showModal = () => {
      statusMsg.style.display = 'none';
      statusMsg.textContent = '';

      if (!this.isDemoMode && this.connectedRoverIp) {
        modalTitle.textContent = 'Active Rover Connection';
        modalSubtitle.textContent = 'ARGUS is currently connected to a physical rover.';
        formFields.style.display = 'none';
        connectedView.style.display = 'block';
        if (connectedIpText) connectedIpText.textContent = this.connectedRoverIp;
        if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
        connectBtnText.textContent = 'Connect another rover';
      } else {
        modalTitle.textContent = 'Add your own rover';
        modalSubtitle.textContent = 'Connect ARGUS to a rover on your local network.';
        formFields.style.display = 'block';
        connectedView.style.display = 'none';
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        connectBtnText.textContent = 'Connect rover';
        if (ipInput) ipInput.value = '';
      }

      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      if (ipInput && formFields.style.display !== 'none') {
        setTimeout(() => ipInput.focus(), 100);
      }
    };

    const hideModal = () => {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    };

    openBtn.addEventListener('click', showModal);
    if (closeBtn) closeBtn.addEventListener('click', hideModal);
    if (cancelBtn) cancelBtn.addEventListener('click', hideModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideModal();
    });

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        disconnectBtn.disabled = true;
        try {
          const res = await fetch('/api/disconnect-rover', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            this.isDemoMode = true;
            this.connectedRoverIp = '';
            this.updateDemoUi(true);
            this.logEvent('SYSTEM', 'Disconnected from rover. Switched to Demo Mode.');
            hideModal();
          }
        } catch (err) {
          console.error('Disconnect error:', err);
        } finally {
          disconnectBtn.disabled = false;
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (connectedView.style.display === 'block') {
          formFields.style.display = 'block';
          connectedView.style.display = 'none';
          modalTitle.textContent = 'Connect Another Rover';
          modalSubtitle.textContent = 'Enter the local IP address of the new rover.';
          connectBtnText.textContent = 'Connect rover';
          if (ipInput) {
            ipInput.value = '';
            ipInput.focus();
          }
          return;
        }

        const rawIp = ipInput.value.trim();
        statusMsg.style.display = 'none';

        const ipv4Pattern = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.){3}(25[0-5]|(2[0-4]|1\d|[1-9]|)\d)$/;
        if (!rawIp || (!ipv4Pattern.test(rawIp) && rawIp !== 'localhost' && rawIp !== '127.0.0.1')) {
          statusMsg.textContent = 'Enter a valid local IP address (e.g. 192.168.1.100).';
          statusMsg.style.display = 'block';
          return;
        }

        connectBtn.disabled = true;
        connectBtnText.textContent = 'Connecting to ' + rawIp + '...';

        try {
          const response = await fetch('/api/connect-rover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: rawIp })
          });

          const data = await response.json();

          if (response.ok && data.success) {
            this.isDemoMode = false;
            this.connectedRoverIp = data.ip || rawIp;
            this.updateDemoUi(false);
            this.logEvent('SYSTEM', `● Physical Rover connected at ${this.connectedRoverIp}. Live data active.`);
            hideModal();
          } else {
            const errText = data.error || `Unable to connect to ${rawIp}`;
            statusMsg.textContent = errText;
            statusMsg.style.display = 'block';
          }
        } catch (err) {
          statusMsg.textContent = `Connection timed out or network error connecting to ${rawIp}`;
          statusMsg.style.display = 'block';
        } finally {
          connectBtn.disabled = false;
          connectBtnText.textContent = 'Connect rover';
        }
      });
    }
  }

  checkHttpsNotice() {
    const notice = document.getElementById('httpsNoticeBanner');
    if (!notice) return;
    if (window.location.protocol === 'https:' && !this.isDemoMode) {
      notice.style.display = 'block';
    } else {
    }
  }

  /* ------------------------------------------------------------- */
  /* Real-Time WebSocket Connection to Node.js Backend Server      */
  /* ------------------------------------------------------------- */
  initWebSocketConnection() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname || 'localhost';
    const wsUrl = `${wsProtocol}//${wsHost}:5000/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isWsConnected = true;
        this.logEvent('SYSTEM', `Connected to ARGUS Backend WebSocket.`);
        
        // Sync config with backend server
        const esp32 = document.getElementById('esp32IpInput')?.value.trim() || '';
        const cam = document.getElementById('esp32CamIpInput')?.value.trim() || '';
        const pi = document.getElementById('piIpInput')?.value.trim() || '';
        this.sendWsMessage('UPDATE_CONFIG', { esp32Ip: esp32, esp32CamIp: cam, piIp: pi, isDemoMode: this.isDemoMode });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      this.ws.onclose = () => {
        this.isWsConnected = false;
        this.logEvent('WARN', 'ARGUS Backend WebSocket disconnected. Reconnecting in 3s...');
        setTimeout(() => this.initWebSocketConnection(), 3000);
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
      };
    } catch (e) {
      console.warn('WebSocket connection failed:', e);
      setTimeout(() => this.initWebSocketConnection(), 5000);
    }
  }

  sendWsMessage(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  handleServerMessage(msg) {
    switch (msg.type) {
      case 'INIT_STATE':
      case 'STATE_UPDATE': {
        const { isDemoMode, currentMode, activeCommand, hardwareConfig, deviceStatus } = msg.payload;
        if (typeof isDemoMode === 'boolean') {
          this.isDemoMode = isDemoMode;
          this.updateDemoUi(isDemoMode);
        }
        if (currentMode) {
          this.currentMode = currentMode;
          this.updateModeUi(currentMode);
        }
        if (activeCommand) {
          this.activeCommand = activeCommand;
          this.updateStatusDisplay(activeCommand);
        }
        if (deviceStatus) {
          this.updateDeviceStatusUi(deviceStatus);
        }
        break;
      }

      case 'TELEMETRY_UPDATE': {
        const { telemetry, deviceStatus, forwardBlocked } = msg.payload;
        this.forwardBlocked = !!forwardBlocked;
        if (deviceStatus) this.updateDeviceStatusUi(deviceStatus);
        this.processBackendTelemetry(telemetry);
        break;
      }

      case 'COMMAND_RESPONSE': {
        const { status, dir, isEmergency, error } = msg.payload;
        if (status === 'ACKNOWLEDGED') {
          this.logEvent('INFO', `Command ACK: ${dir || 'STOP'} acknowledged by hardware.`);
        } else if (status === 'REJECTED') {
          this.logEvent('WARN', `Command Rejected: ${error || 'Invalid state'}`);
        } else if (status === 'FAILED') {
          this.logEvent('SAFETY', `Command Failed: ${error || 'Hardware timeout'}`);
        }
        break;
      }

      case 'WATCHDOG_TRIGGERED': {
        const { reason } = msg.payload;
        this.logEvent('SAFETY', `✖ WATCHDOG INTERLOCK: ${reason}. Emergency Stop executed.`);
        this.sendStopCommand('Hardware watchdog timeout');
        break;
      }

      case 'EVENT_LOG': {
        const { type, message } = msg.payload;
        this.logEvent(type, message);
        break;
      }
    }
  }

  updateDeviceStatusUi(deviceStatus) {
    if (!deviceStatus) return;
    this.setLinkStatus('esp32', deviceStatus.esp32 === 'CONNECTED');
    this.setLinkStatus('cam', deviceStatus.esp32Cam === 'CONNECTED');
    this.setLinkStatus('pi', deviceStatus.pi === 'CONNECTED');
    this.setLinkStatus('robot', deviceStatus.esp32 === 'CONNECTED');
  }

  processBackendTelemetry(data) {
    const pressureValTop = document.getElementById('pressureValueTop');
    const pressureStatusSub = document.getElementById('pressureStatusSub');
    const gasPpmLarge = document.getElementById('gasPpmLarge');
    const gasStatePill = document.getElementById('gasStatePill');

    if (!data) {
      // Disconnected State
      if (pressureValTop) pressureValTop.textContent = '--';
      if (pressureStatusSub) pressureStatusSub.textContent = 'Unavailable';
      if (gasPpmLarge) gasPpmLarge.textContent = 'Offline';
      if (gasStatePill) {
        gasStatePill.className = 'gas-state-pill warning';
        gasStatePill.innerHTML = '<span>&#x26A0;</span> <span>UNAVAILABLE</span>';
      }
      return;
    }

    // Telemetry Available
    this.currentGas = data.gas || 0;
    this.currentGasRaw = data.gas_raw || 0;
    this.currentPressure = data.pressure;
    this.alarmPin = data.gas_alarm ? 'TRIGGERED' : 'CLEAR';
    this.detectedObjects = Array.isArray(data.objects) ? data.objects : (Array.isArray(data.labels) ? data.labels : []);

    // Update Gas & Pressure UI
    this.updateGasUi();

    if (pressureValTop) {
      if (typeof data.pressure === 'number') {
        pressureValTop.textContent = data.pressure.toFixed(1);
        if (pressureStatusSub) pressureStatusSub.textContent = data.pressure_status || 'Normal';
      } else {
        pressureValTop.textContent = '--';
        if (pressureStatusSub) pressureStatusSub.textContent = 'Unavailable';
      }
    }

    // Push to History
    this.gasHistory.push({ time: new Date(), ppm: this.currentGas, raw: this.currentGasRaw, alarm: this.alarmPin });
    if (this.gasHistory.length > 60) this.gasHistory.shift();
    this.renderGasChart();
  }

  /* ------------------------------------------------------------- */
  /* UI Event Handlers & Connections                              */
  /* ------------------------------------------------------------- */
  bindUiEvents() {
    // Connect Button
    const btnConnect = document.getElementById('btnConnect');
    if (btnConnect) {
      btnConnect.addEventListener('click', () => {
        const esp32 = document.getElementById('esp32IpInput')?.value.trim() || '';
        const cam = document.getElementById('esp32CamIpInput')?.value.trim() || '';
        const pi = document.getElementById('piIpInput')?.value.trim() || '';

        this.updateConfigUrls(esp32, cam, pi);
        this.saveSettings();

        if (esp32 || cam || pi) {
          this.isDemoMode = false;
          this.updateDemoUi(false);
          this.logEvent('SYSTEM', `Hardware IPs saved. Initiating link...`);
          this.connectHardware();
        } else {
          this.isDemoMode = true;
          this.updateDemoUi(true);
          this.logEvent('SYSTEM', `No IPs provided. Demo Mode restored.`);
        }
      });
    }

    // Toggle Demo Button
    const btnToggleDemo = document.getElementById('btnToggleDemo');
    if (btnToggleDemo) {
      btnToggleDemo.addEventListener('click', () => {
        this.isDemoMode = !this.isDemoMode;
        this.updateDemoUi(this.isDemoMode);
        this.logEvent('SYSTEM', `Demo Mode explicitly ${this.isDemoMode ? 'ENABLED' : 'DISABLED'}.`);
        if (!this.isDemoMode) {
          this.connectHardware();
        }
      });
    }

    // Camera Viewport Tabs (Front Camera vs Rear Camera)
    const btnFrontCam = document.getElementById('btnFrontCam');
    const btnRearCam = document.getElementById('btnRearCam');
    const cameraFeedImg = document.getElementById('cameraFeedImg');
    const cam1StatusLabel = document.getElementById('cam1StatusLabel');

    if (btnFrontCam && btnRearCam && cameraFeedImg) {
      btnFrontCam.addEventListener('click', () => {
        btnFrontCam.classList.add('active');
        btnRearCam.classList.remove('active');
        cameraFeedImg.src = '/assets/rover-camera-feed.jpg';
        if (cam1StatusLabel) cam1StatusLabel.textContent = '● FRONT CAMERA OPTICAL FEED';
        this.logEvent('INFO', 'Switched visual feed to FRONT OPTICAL CAM.');
      });

      btnRearCam.addEventListener('click', () => {
        btnRearCam.classList.add('active');
        btnFrontCam.classList.remove('active');
        cameraFeedImg.src = '/assets/argus-warehouse-operating.jpg';
        if (cam1StatusLabel) cam1StatusLabel.textContent = '● REAR CAMERA OPTICAL FEED';
        this.logEvent('INFO', 'Switched visual feed to REAR OPTICAL CAM.');
      });
    }

    // Camera Reload / Expand Controls
    document.getElementById('btnCam1Reload')?.addEventListener('click', () => {
      if (cameraFeedImg) {
        const currentSrc = cameraFeedImg.src;
        cameraFeedImg.src = '';
        setTimeout(() => { cameraFeedImg.src = currentSrc; }, 120);
      }
      this.logEvent('SYSTEM', 'Camera feed refreshed.');
    });
    document.getElementById('btnCam1Fullscreen')?.addEventListener('click', () => this.toggleFullscreen('cam1Viewport'));

    // Mode Selector (Manual / Autonomous)
    const modeManualBtn = document.getElementById('modeManualBtn');
    const modeAutoBtn = document.getElementById('modeAutoBtn');

    if (modeManualBtn && modeAutoBtn) {
      modeManualBtn.addEventListener('click', () => this.switchOperationMode('MANUAL'));
      modeAutoBtn.addEventListener('click', () => this.switchOperationMode('AUTONOMOUS'));
    }

    // Speed Slider
    const speedSlider = document.getElementById('speedSlider');
    const speedDisplay = document.getElementById('speedValue');
    const speedDisplayTop = document.getElementById('speedValueTop');
    const statusSpeedVal = document.getElementById('statusSpeedVal');

    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        this.motorSpeed = parseInt(e.target.value, 10);
        if (speedDisplay) speedDisplay.textContent = this.motorSpeed;
        if (speedDisplayTop) speedDisplayTop.textContent = this.motorSpeed;
        if (statusSpeedVal) statusSpeedVal.textContent = this.motorSpeed;
      });
    }

    // D-Pad Pointer Events (Touch, Mouse, Stylus) — Centralized Handler Integration
    const dpadButtons = document.querySelectorAll('.dpad-btn[data-cmd]');
    dpadButtons.forEach((btn) => {
      const cmd = btn.dataset.cmd;

      const onPointerDown = (e) => {
        e.preventDefault();
        try {
          if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
        } catch (err) {}
        this.executeDriveCommand(cmd, true, 'ON-SCREEN BUTTON');
      };

      const onPointerUp = (e) => {
        e.preventDefault();
        try {
          if (btn.releasePointerCapture && btn.hasPointerCapture(e.pointerId)) {
            btn.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
        this.executeDriveCommand(cmd, false, 'ON-SCREEN BUTTON');
      };

      btn.addEventListener('pointerdown', onPointerDown);
      btn.addEventListener('pointerup', onPointerUp);
      btn.addEventListener('pointerleave', onPointerUp);
      btn.addEventListener('pointercancel', onPointerUp);
    });

    // Reset Peak Button
    document.getElementById('btnResetPeak')?.addEventListener('click', () => {
      this.peakGas = this.currentGas;
      const peakElem = document.getElementById('gasPeakVal');
      if (peakElem) peakElem.textContent = `${this.peakGas} ppm`;
      this.logEvent('INFO', `Peak gas reading reset to ${this.peakGas} ppm.`);
    });

    // Threshold Inputs
    const warnInput = document.getElementById('warningLimitInput');
    const dangerInput = document.getElementById('dangerLimitInput');

    if (warnInput) {
      warnInput.addEventListener('change', (e) => {
        this.warningLimit = parseInt(e.target.value, 10) || 400;
        this.saveSettings();
        this.evaluateGasConditions();
        this.renderGasChart();
        this.logEvent('INFO', `Warning limit updated: ${this.warningLimit} ppm`);
      });
    }

    if (dangerInput) {
      dangerInput.addEventListener('change', (e) => {
        this.dangerLimit = parseInt(e.target.value, 10) || 1000;
        this.saveSettings();
        this.evaluateGasConditions();
        this.renderGasChart();
        this.logEvent('INFO', `Danger limit updated: ${this.dangerLimit} ppm`);
      });
    }

    // Safety Switches
    const autoStopToggle = document.getElementById('autoStopToggle');
    if (autoStopToggle) {
      autoStopToggle.addEventListener('change', (e) => {
        this.autoStopOnDanger = e.target.checked;
        this.saveSettings();
      });
    }

    const soundAlarmToggle = document.getElementById('soundAlarmToggle');
    if (soundAlarmToggle) {
      soundAlarmToggle.addEventListener('change', (e) => {
        this.soundAlarmEnabled = e.target.checked;
        this.saveSettings();
      });
    }

    // CSV Log Export
    document.getElementById('btnDownloadCsv')?.addEventListener('click', () => this.exportCsvLog());
  }

  /* ------------------------------------------------------------- */
  /* Hardware Connectivity & Ping Routine                         */
  /* ------------------------------------------------------------- */
  connectHardware() {
    if (this.isDemoMode) return;
    this.reloadCamera(1);
    this.reloadCamera(2);
    this.pingEsp32();
  }

  startPingLoop() {
    // Ping ESP32 every 3 seconds with a 1.5s timeout
    setInterval(() => {
      if (this.isDemoMode) {
        this.setLinkStatus('esp32', true);
        this.setLinkStatus('robot', true);
        return;
      }
      this.pingEsp32();
    }, 3000);
  }

  pingEsp32() {
    if (!CONFIG.esp32.base) {
      this.setLinkStatus('esp32', false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    fetch(`${CONFIG.esp32.base}${CONFIG.esp32.ping}`, {
      method: 'GET',
      mode: 'no-cors',
      signal: controller.signal
    })
      .then(() => {
        clearTimeout(timeoutId);
        this.setLinkStatus('esp32', true);
        this.setLinkStatus('robot', true);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        this.setLinkStatus('esp32', false);
        this.setLinkStatus('robot', false);
      });
  }

  setLinkStatus(device, isOnline) {
    let dot = null;
    if (device === 'esp32') dot = document.getElementById('esp32StatusDot');
    if (device === 'cam') dot = document.getElementById('esp32CamStatusDot');
    if (device === 'pi') dot = document.getElementById('piStatusDot');
    if (device === 'robot') {
      const rDot = document.getElementById('robotStatusDot');
      const rText = document.getElementById('robotStatusText');
      if (rDot && rText) {
        rDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        rText.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
      }
    }

    if (dot) {
      dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
    }
  }

  /* ------------------------------------------------------------- */
  /* Camera Stream Handling & States                              */
  /* ------------------------------------------------------------- */
  reloadCamera(camIndex) {
    if (this.isDemoMode) {
      const overlay = document.getElementById(`cam${camIndex}Overlay`);
      if (overlay) overlay.style.display = 'none';
      return;
    }

    const img = document.getElementById(`cam${camIndex}Img`);
    const overlay = document.getElementById(`cam${camIndex}Overlay`);
    const msg = document.getElementById(`cam${camIndex}OverlayMsg`);
    const retryBtn = document.getElementById(`cam${camIndex}RetryBtn`);
    const dot = document.getElementById(`cam${camIndex}StatusDot`);

    if (!img) return;

    let baseUrl = camIndex === 1 ? CONFIG.esp32Cam.stream : `${CONFIG.pi.base}${CONFIG.pi.video}`;
    if (!baseUrl) {
      if (overlay && msg) {
        overlay.style.display = 'flex';
        msg.textContent = 'IP NOT CONFIGURED';
        if (retryBtn) retryBtn.style.display = 'none';
      }
      if (dot) dot.className = 'status-dot offline';
      return;
    }

    // Add cache buster
    const streamUrl = `${baseUrl}?t=${Date.now()}`;

    if (overlay && msg) {
      overlay.style.display = 'flex';
      msg.textContent = 'CONNECTING TO CAMERA...';
      if (retryBtn) retryBtn.style.display = 'none';
    }
    if (dot) dot.className = 'status-dot warn';

    img.style.display = 'none';

    img.onload = () => {
      if (overlay) overlay.style.display = 'none';
      img.style.display = 'block';
      if (dot) dot.className = 'status-dot online';
      if (camIndex === 1) this.setLinkStatus('cam', true);
      if (camIndex === 2) this.setLinkStatus('pi', true);
    };

    img.onerror = () => {
      if (overlay && msg) {
        overlay.style.display = 'flex';
        msg.textContent = 'CAMERA UNAVAILABLE';
        if (retryBtn) retryBtn.style.display = 'inline-block';
      }
      img.style.display = 'none';
      if (dot) dot.className = 'status-dot offline';
      if (camIndex === 1) this.setLinkStatus('cam', false);
      this.logEvent('WARN', `Camera ${camIndex} feed offline.`);
    };

    img.src = streamUrl;
  }

  toggleFullscreen(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) {
          el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    } catch (e) {
      console.warn('Fullscreen request failed:', e);
    }
  }

  /* ------------------------------------------------------------- */
  /* Rover Motor Driving, Heartbeat & Safety Interlocks           */
  /* ------------------------------------------------------------- */
  startMovement(dir) {
    if (this.currentMode === 'AUTONOMOUS') return;

    if (dir === 'F' && this.forwardBlocked) {
      this.sendStopCommand('FORWARD BLOCKED DUE TO HAZARDOUS GAS');
      return;
    }

    this.activeCommand = dir;
    this.updateStatusDisplay(dir);

    // Send immediately
    this.sendMotorPacket(dir, this.motorSpeed);

    // Command Heartbeat: every 200ms while moving
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.activeCommand !== 'S') {
        if (this.activeCommand === 'F' && this.forwardBlocked) {
          this.stopMovement();
          return;
        }
        this.sendMotorPacket(this.activeCommand, this.motorSpeed);
      }
    }, 200);

    const dirNameMap = { F: 'FORWARD', B: 'REVERSE', L: 'LEFT', R: 'RIGHT' };
    this.logEvent('INFO', `Drive: ${dirNameMap[dir] || dir} @ Speed ${this.motorSpeed}`);
  }

  stopMovement() {
    this.activeCommand = 'S';
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.sendMotorPacket('S', 0);
    this.updateStatusDisplay('STOP');
  }

  /* ------------------------------------------------------------- */
  /* Central Unified Rover Command Handler                          */
  /* Shared by Physical Keyboard (Arrows/Space) and On-Screen D-Pad*/
  /* ------------------------------------------------------------- */
  executeDriveCommand(cmd, isPress, source = 'UI') {
    if (this.currentMode === 'AUTONOMOUS') {
      if (isPress && cmd !== 'S') {
        this.logEvent('WARN', `Command '${cmd}' rejected: Autonomous mode active`);
      }
      return;
    }

    const btnIdMap = { F: 'btnForward', B: 'btnReverse', L: 'btnLeft', R: 'btnRight', S: 'btnStop' };
    const targetBtn = document.getElementById(btnIdMap[cmd]);

    if (isPress) {
      if (targetBtn) {
        targetBtn.classList.add('pressed', 'active');
      }

      if (cmd === 'S') {
        this.sendStopCommand(`EMERGENCY STOP (${source})`);
        return;
      }

      if (cmd === 'F' && this.forwardBlocked) {
        this.sendStopCommand('FORWARD BLOCKED DUE TO HAZARDOUS GAS');
        return;
      }

      this.startMovement(cmd);
    } else {
      if (targetBtn) {
        targetBtn.classList.remove('pressed', 'active');
      }

      if (cmd !== 'S') {
        this.stopMovement();
      }
    }
  }

  isInputFocused(target) {
    if (!target) return false;
    const tagName = target.tagName ? target.tagName.toUpperCase() : '';
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      target.isContentEditable === true
    );
  }

  sendStopCommand(reason) {
    this.stopMovement();
    document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('pressed', 'active'));
    this.pressedKeys.clear();
    if (reason) this.logEvent('SAFETY', reason);
  }

  sendMotorPacket(dir, speed) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsMessage('DRIVE_COMMAND', { dir, speed });
      return;
    }

    if (this.isDemoMode || !CONFIG.esp32.base) return;

    const url = `${CONFIG.esp32.base}${CONFIG.esp32.command}?dir=${encodeURIComponent(dir)}&speed=${encodeURIComponent(speed)}`;
    fetch(url, { method: 'GET', mode: 'no-cors' }).catch(() => {
      // Gracefully swallow network errors during drive heartbeats
    });
  }

  updateStatusDisplay(cmd) {
    const cmdVal = document.getElementById('statusCommandVal');
    if (cmdVal) {
      const map = { F: 'FORWARD', B: 'REVERSE', L: 'LEFT', R: 'RIGHT', S: 'STOP' };
      cmdVal.textContent = map[cmd] || cmd;
      cmdVal.style.color = cmd === 'S' ? 'var(--muted)' : 'var(--primary)';
    }
  }

  /* ------------------------------------------------------------- */
  /* Physical Keyboard Driving Controls                            */
  /* ------------------------------------------------------------- */
  setupKeyboardControls() {
    const moveKeyMap = {
      arrowup: 'F',
      arrowdown: 'B',
      arrowleft: 'L',
      arrowright: 'R',
      w: 'F',
      s: 'B',
      a: 'L',
      d: 'R'
    };

    window.addEventListener('keydown', (e) => {
      if (this.isInputFocused(e.target)) return;

      const key = e.key.toLowerCase();

      // Prevent scrolling on arrow keys & spacebar
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'spacebar'].includes(key)) {
        e.preventDefault();
      }

      if (e.repeat) return;

      // Spacebar = Priority Emergency Stop
      if (key === ' ' || key === 'spacebar') {
        this.emergencyStopLatched = true;
        this.pressedKeys.clear();
        this.executeDriveCommand('S', true, 'SPACEBAR');
        return;
      }

      // If Emergency Stop was latched, block movement until space released
      if (this.emergencyStopLatched) return;

      if (moveKeyMap[key]) {
        const cmd = moveKeyMap[key];
        this.pressedKeys.add(key);

        // Check for conflicting keys (Up + Down or Left + Right)
        const hasUpDownConflict =
          (this.pressedKeys.has('arrowup') || this.pressedKeys.has('w')) &&
          (this.pressedKeys.has('arrowdown') || this.pressedKeys.has('s'));
        const hasLeftRightConflict =
          (this.pressedKeys.has('arrowleft') || this.pressedKeys.has('a')) &&
          (this.pressedKeys.has('arrowright') || this.pressedKeys.has('d'));

        if (hasUpDownConflict || hasLeftRightConflict) {
          this.executeDriveCommand('S', true, 'CONFLICTING KEYS');
          return;
        }

        this.executeDriveCommand(cmd, true, 'KEYBOARD');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.isInputFocused(e.target)) return;

      const key = e.key.toLowerCase();

      if (key === ' ' || key === 'spacebar') {
        this.emergencyStopLatched = false;
        this.executeDriveCommand('S', false, 'SPACEBAR');
        const stopBtn = document.getElementById('btnStop');
        if (stopBtn) stopBtn.classList.remove('pressed', 'active');
        return;
      }

      if (moveKeyMap[key]) {
        const cmd = moveKeyMap[key];
        this.pressedKeys.delete(key);
        this.executeDriveCommand(cmd, false, 'KEYBOARD');

        if (this.pressedKeys.size > 0 && !this.emergencyStopLatched) {
          const remainingKey = Array.from(this.pressedKeys).pop();
          const remainingCmd = moveKeyMap[remainingKey];

          const hasUpDownConflict =
            (this.pressedKeys.has('arrowup') || this.pressedKeys.has('w')) &&
            (this.pressedKeys.has('arrowdown') || this.pressedKeys.has('s'));
          const hasLeftRightConflict =
            (this.pressedKeys.has('arrowleft') || this.pressedKeys.has('a')) &&
            (this.pressedKeys.has('arrowright') || this.pressedKeys.has('d'));

          if (remainingCmd && !hasUpDownConflict && !hasLeftRightConflict) {
            this.executeDriveCommand(remainingCmd, true, 'KEYBOARD');
          } else if (hasUpDownConflict || hasLeftRightConflict) {
            this.executeDriveCommand('S', true, 'CONFLICTING KEYS');
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------- */
  /* Browser Safety (Window Blur, Visibility Change)               */
  /* ------------------------------------------------------------- */
  setupBrowserSafety() {
    const safeStop = (reason) => {
      if (this.activeCommand !== 'S') {
        this.sendStopCommand(reason);
      } else {
        document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('pressed', 'active'));
        this.pressedKeys.clear();
      }
    };

    window.addEventListener('blur', () => {
      safeStop('Browser window lost focus → Fail-Safe Stop');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        safeStop('Browser tab hidden → Fail-Safe Stop');
      }
    });

    window.addEventListener('beforeunload', () => {
      this.sendMotorPacket('S', 0);
    });
  }

  /* ------------------------------------------------------------- */
  /* Mode Switching (Manual vs Autonomous)                         */
  /* ------------------------------------------------------------- */
  switchOperationMode(newMode) {
    if (this.currentMode === newMode) return;

    // Send Stop first!
    this.sendStopCommand(`Mode switched to ${newMode}`);

    this.currentMode = newMode;
    const modeManualBtn = document.getElementById('modeManualBtn');
    const modeAutoBtn = document.getElementById('modeAutoBtn');
    const autoNotice = document.getElementById('autoModeNotice');
    const statusModeVal = document.getElementById('statusModeVal');

    if (modeManualBtn) modeManualBtn.classList.toggle('active', newMode === 'MANUAL');
    if (modeAutoBtn) modeAutoBtn.classList.toggle('active', newMode === 'AUTONOMOUS');
    if (autoNotice) autoNotice.style.display = newMode === 'AUTONOMOUS' ? 'block' : 'none';
    if (statusModeVal) statusModeVal.textContent = newMode;

    // Disable / Enable D-Pad
    const dpadButtons = document.querySelectorAll('.dpad-btn:not(.stop-btn)');
    dpadButtons.forEach(btn => {
      btn.disabled = (newMode === 'AUTONOMOUS');
    });

    // Notify Raspberry Pi
    if (!this.isDemoMode && CONFIG.pi.base) {
      const modeParam = newMode === 'AUTONOMOUS' ? 'auto' : 'manual';
      fetch(`${CONFIG.pi.base}${CONFIG.pi.mode}?m=${modeParam}`, {
        method: 'GET',
        mode: 'no-cors'
      }).catch(() => {});
    }

    this.logEvent('SYSTEM', `Operating Mode: ${newMode}`);
  }

  /* ------------------------------------------------------------- */
  /* Telemetry Ingestion (Gas, AI Labels, Danger Logic)            */
  /* ------------------------------------------------------------- */
  startTelemetryLoop() {
    setInterval(() => {
      if (this.isDemoMode) {
        this.simulateTelemetry();
      } else {
        this.fetchHardwareTelemetry();
      }
    }, 1000);
  }

  simulateTelemetry() {
    // Smooth random walk for simulated gas
    const delta = (Math.random() - 0.48) * 8;
    this.currentGas = Math.max(90, Math.min(1300, Math.round(this.currentGas + delta)));

    // Occasional simulated hazard spike (1% chance)
    if (Math.random() < 0.015 && this.currentGas < this.warningLimit) {
      this.currentGas = 1050; // Trigger demo danger!
    }

    this.currentGasRaw = Math.round(this.currentGas * 48.2 + Math.random() * 20);
    this.alarmPin = this.currentGas >= this.warningLimit ? 'TRIGGERED' : 'CLEAR';
    this.sensorReady = true;

    // Occasional variation in detected AI objects
    if (Math.random() < 0.05) {
      const sampleSets = [
        ['PERSON', 'OIL SPILL'],
        ['CHEMICAL_DRUM', 'OBSTACLE'],
        ['PERSON'],
        ['STORAGE_RACK', 'DRUM_LEAK']
      ];
      this.detectedObjects = sampleSets[Math.floor(Math.random() * sampleSets.length)];
    }

    this.processTelemetryPacket({
      gas: this.currentGas,
      gas_raw: this.currentGasRaw,
      gas_alarm: this.alarmPin === 'TRIGGERED',
      gas_ready: true,
      objects: this.detectedObjects.length,
      labels: this.detectedObjects
    });
  }

  fetchHardwareTelemetry() {
    if (!CONFIG.pi.base) return;

    fetch(`${CONFIG.pi.base}${CONFIG.pi.data}`)
      .then(res => res.json())
      .then(data => {
        this.setLinkStatus('pi', true);
        this.processTelemetryPacket(data);
      })
      .catch(() => {
        this.setLinkStatus('pi', false);
      });
  }

  processTelemetryPacket(data) {
    if (!data) return;

    this.currentGas = typeof data.gas === 'number' ? data.gas : this.currentGas;
    this.currentGasRaw = typeof data.gas_raw === 'number' ? data.gas_raw : this.currentGasRaw;
    this.alarmPin = data.gas_alarm ? 'TRIGGERED' : 'CLEAR';
    this.sensorReady = data.gas_ready !== false;
    this.detectedObjects = Array.isArray(data.labels) ? data.labels : [];

    if (typeof data.pressure === 'number') {
      this.currentPressure = data.pressure;
    }

    // Track Peak
    if (this.currentGas > this.peakGas) {
      this.peakGas = this.currentGas;
    }

    // Append to 60s Gas History
    this.gasHistory.push({
      time: new Date(),
      ppm: this.currentGas,
      raw: this.currentGasRaw,
      alarm: this.alarmPin
    });

    // Retain only last 60 entries (60 seconds)
    if (this.gasHistory.length > 60) {
      this.gasHistory.shift();
    }

    // Update UI & Danger Logic
    this.updateGasUi();
    this.updatePressureUi();
    this.updateAiUi(data.objects || this.detectedObjects.length);
    this.evaluateGasConditions();
    this.renderGasChart();
  }

  updatePressureUi() {
    const pressureValTop = document.getElementById('pressureValueTop');
    if (pressureValTop) {
      pressureValTop.textContent = typeof this.currentPressure === 'number' ? this.currentPressure.toFixed(1) : this.currentPressure;
    }
  }

  updateGasUi() {
    const gasPpmLarge = document.getElementById('gasPpmLarge');
    const gasRawVal = document.getElementById('gasRawVal');
    const gasPeakVal = document.getElementById('gasPeakVal');
    const alarmPinVal = document.getElementById('alarmPinVal');
    const sensorStatusVal = document.getElementById('sensorStatusVal');
    const gasStatePill = document.getElementById('gasStatePill');

    if (gasPpmLarge) gasPpmLarge.textContent = `${this.currentGas} ppm`;
    if (gasRawVal) gasRawVal.textContent = this.currentGasRaw;
    if (gasPeakVal) gasPeakVal.textContent = `${this.peakGas} ppm`;
    if (alarmPinVal) {
      alarmPinVal.textContent = this.alarmPin;
      alarmPinVal.style.color = this.alarmPin === 'TRIGGERED' ? 'var(--danger)' : 'var(--text)';
    }
    if (sensorStatusVal) {
      sensorStatusVal.textContent = this.sensorReady ? 'READY' : 'WARMING UP';
      sensorStatusVal.style.color = this.sensorReady ? 'var(--success)' : 'var(--warning)';
    }

    // Status Pill: SAFE / WARNING / DANGER
    if (gasStatePill) {
      if (this.currentGas >= this.dangerLimit) {
        gasStatePill.className = 'gas-state-pill danger';
        gasStatePill.innerHTML = '<span>&#x2716;</span> <span>DANGER</span>';
      } else if (this.currentGas >= this.warningLimit) {
        gasStatePill.className = 'gas-state-pill warning';
        gasStatePill.innerHTML = '<span>&#x25B2;</span> <span>WARNING</span>';
      } else {
        gasStatePill.className = 'gas-state-pill safe';
        gasStatePill.innerHTML = '<span>&#x25CF;</span> <span>SAFE</span>';
      }
    }
  }

  updateAiUi(count) {
    const countElem = document.getElementById('aiObjectsCount');
    const statusAiVal = document.getElementById('statusAiVal');
    const container = document.getElementById('aiChipsContainer');

    if (countElem) countElem.textContent = count;
    if (statusAiVal) statusAiVal.textContent = count;

    if (container) {
      if (this.detectedObjects.length === 0) {
        container.innerHTML = '<span style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--muted);">No objects detected</span>';
      } else {
        container.innerHTML = this.detectedObjects
          .map(lbl => {
            const isHazard = ['OIL SPILL', 'DRUM_LEAK', 'HAZARD', 'FIRE'].some(h => lbl.toUpperCase().includes(h));
            return `<span class="ai-chip ${isHazard ? 'hazard-chip' : ''}">${this.escapeHtml(lbl.toUpperCase())}</span>`;
          })
          .join('');
      }
    }
  }

  evaluateGasConditions() {
    const dangerBanner = document.getElementById('dangerBanner');
    const forwardBtn = document.getElementById('btnForward');

    if (this.currentGas >= this.dangerLimit) {
      // ENTERING DANGER
      if (!this.inDangerState) {
        this.inDangerState = true;
        this.logEvent('SAFETY', `✖ CRITICAL: Gas concentration ${this.currentGas} ppm exceeds Danger Limit (${this.dangerLimit} ppm)!`);

        // Vibrate phone if supported
        if ('vibrate' in navigator) {
          try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (e) {}
        }

        // Web Audio API Beep
        if (this.soundAlarmEnabled) {
          this.playAlarmBeep();
        }

        // Auto-stop rover
        if (this.autoStopOnDanger && this.activeCommand !== 'S') {
          this.sendStopCommand('Auto-stop triggered by critical gas hazard.');
        }
      }

      if (dangerBanner) dangerBanner.style.display = 'block';

      // SAFE MOVEMENT RULE: BLOCK FORWARD, ALLOW REVERSE, LEFT, RIGHT
      this.forwardBlocked = true;
      if (forwardBtn) {
        forwardBtn.classList.add('blocked');
        forwardBtn.disabled = true;
        forwardBtn.title = 'BLOCKED: Gas hazard detected ahead';
      }

      if (this.activeCommand === 'F') {
        this.stopMovement();
      }

    } else {
      // BELOW DANGER
      if (this.inDangerState) {
        this.inDangerState = false;
        this.logEvent('INFO', `Gas levels dropped below danger threshold (${this.currentGas} ppm). Forward drive unblocked.`);
      }

      if (dangerBanner) dangerBanner.style.display = 'none';

      // Unblock forward
      this.forwardBlocked = false;
      if (forwardBtn && this.currentMode === 'MANUAL') {
        forwardBtn.classList.remove('blocked');
        forwardBtn.disabled = false;
        forwardBtn.title = 'Forward (W / Up)';
      }
    }
  }

  playAlarmBeep() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // 880 Hz
      osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.28);

      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.28);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch (e) {
      console.warn('Web Audio not allowed or failed:', e);
    }
  }

  /* ------------------------------------------------------------- */
  /* Live 60-Second Gas Graph (High-DPI Canvas & Tooltip)           */
  /* ------------------------------------------------------------- */
  renderGasChart() {
    if (!this.chartCanvas) return;
    const canvas = this.chartCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 480;
    const height = rect.height || 180;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Padding for axes
    const padLeft = 44;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 26;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Determine Y-scale range (at least up to danger limit + 200)
    const maxData = Math.max(...this.gasHistory.map(d => d.ppm), 300);
    const maxY = Math.max(this.dangerLimit * 1.25, maxData * 1.15, 600);

    ctx.clearRect(0, 0, width, height);

    // Grid lines & Y-axis labels
    ctx.font = '500 10px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    const yTicks = [0, Math.round(maxY * 0.33), Math.round(maxY * 0.66), Math.round(maxY)];
    yTicks.forEach(val => {
      const y = padTop + plotH - (val / maxY) * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`${val}`, 6, y + 3);
    });

    // Warning Threshold Line (Dashed Orange)
    if (this.warningLimit <= maxY) {
      const warnY = padTop + plotH - (this.warningLimit / maxY) * plotH;
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, warnY);
      ctx.lineTo(width - padRight, warnY);
      ctx.stroke();
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`WARN: ${this.warningLimit}`, width - padRight - 66, warnY - 4);
    }

    // Danger Threshold Line (Dashed Red)
    if (this.dangerLimit <= maxY) {
      const dangerY = padTop + plotH - (this.dangerLimit / maxY) * plotH;
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, dangerY);
      ctx.lineTo(width - padRight, dangerY);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`DANGER: ${this.dangerLimit}`, width - padRight - 78, dangerY - 4);
    }
    ctx.setLineDash([]); // Reset dash

    // Time Axis Ticks (-60s, -30s, NOW)
    ctx.fillStyle = '#64748b';
    ctx.fillText('-60s', padLeft, height - 8);
    ctx.fillText('-30s', padLeft + plotW * 0.5 - 10, height - 8);
    ctx.fillText('NOW', width - padRight - 24, height - 8);

    if (this.gasHistory.length < 2) return;

    // Draw Gas Curve Path
    const points = this.gasHistory.map((d, idx) => {
      const x = padLeft + (idx / 59) * plotW;
      const y = padTop + plotH - (d.ppm / maxY) * plotH;
      return { x, y, ppm: d.ppm, time: d.time };
    });

    this.cachedPoints = points; // Used for hover tooltip hit-testing

    // Area Gradient Fill
    const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    areaGrad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
    areaGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, padTop + plotH);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Gas Curve Stroke
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Current Value Dot at End
    const latest = points[points.length - 1];
    ctx.fillStyle = this.currentGas >= this.dangerLimit ? '#ef4444' : this.currentGas >= this.warningLimit ? '#f59e0b' : '#22c55e';
    ctx.beginPath();
    ctx.arc(latest.x, latest.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  setupChartInteraction() {
    if (!this.chartCanvas || !this.chartTooltip) return;

    const onMove = (e) => {
      if (!this.cachedPoints || this.cachedPoints.length === 0) return;
      const rect = this.chartCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const mouseX = clientX - rect.left;

      // Find closest data point
      let closest = null;
      let minDist = Infinity;
      this.cachedPoints.forEach(p => {
        const dist = Math.abs(p.x - mouseX);
        if (dist < minDist) {
          minDist = dist;
          closest = p;
        }
      });

      if (closest && minDist < 30) {
        const secondsAgo = Math.max(0, Math.round((Date.now() - closest.time.getTime()) / 1000));
        this.chartTooltip.style.display = 'block';
        this.chartTooltip.style.left = `${closest.x}px`;
        this.chartTooltip.style.top = `${closest.y - 32}px`;
        this.chartTooltip.textContent = `${closest.ppm} ppm (${secondsAgo}s ago)`;
      } else {
        this.chartTooltip.style.display = 'none';
      }
    };

    this.chartCanvas.addEventListener('mousemove', onMove);
    this.chartCanvas.addEventListener('touchmove', onMove, { passive: true });
    this.chartCanvas.addEventListener('mouseleave', () => {
      this.chartTooltip.style.display = 'none';
    });

    window.addEventListener('resize', () => {
      this.renderGasChart();
    });

    const themeObserver = new MutationObserver(() => {
      this.renderGasChart();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ------------------------------------------------------------- */
  /* Real Interactive Leaflet Map & GPS Navigation                  */
  /* ------------------------------------------------------------- */
  initLeafletMap() {
    const mapElem = document.getElementById('argusMap');
    if (!mapElem || typeof L === 'undefined') return;

    // ARGUS Demo GPS Coordinates (Industrial Facility)
    const roverLat = 28.6139;
    const roverLng = 77.2090;
    const roverCoords = [roverLat, roverLng];

    const wp1Coords = [28.6146, 77.2081];
    const wp2Coords = [28.6142, 77.2098];
    const wp3Coords = [28.6134, 77.2104];

    // Initialize Leaflet Map
    this.map = L.map('argusMap', {
      zoomControl: true,
      attributionControl: false
    }).setView(roverCoords, 17);

    // OpenStreetMap Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.map);

    // Rover Marker DivIcon
    const roverIcon = L.divIcon({
      className: 'custom-rover-leaflet-marker',
      html: `
        <div style="position: relative; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">
          <div style="width: 12px; height: 12px; background-color: var(--accent-gold); border-radius: 50%; border: 2px solid #FFFDF8; box-shadow: 0 0 10px rgba(176,138,69,0.9); z-index: 2;"></div>
          <div style="position: absolute; inset: -6px; border: 1.5px solid var(--accent-gold); border-radius: 50%; animation: mapPulse 2s infinite ease-out; z-index: 1;"></div>
        </div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const wpIcon = (label, color = '#B88932') => L.divIcon({
      className: 'custom-wp-leaflet-marker',
      html: `<div style="background: rgba(23,23,23,0.9); color: #FFFDF8; border: 1px solid ${color}; padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.625rem; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${label}</div>`,
      iconAnchor: [16, 10]
    });

    // Add Markers
    this.roverMarker = L.marker(roverCoords, { icon: roverIcon }).addTo(this.map);
    this.roverMarker.bindPopup('<strong>📍 ARGUS Rover</strong><br>Sector 04 &bull; Chemical Bay B<br>Status: Operational');

    L.marker(wp1Coords, { icon: wpIcon('WP-01', '#64748b') }).addTo(this.map).bindPopup('<strong>WP-01</strong>: Entry Airlock');
    L.marker(wp2Coords, { icon: wpIcon('WP-02', '#64748b') }).addTo(this.map).bindPopup('<strong>WP-02</strong>: Duct Entrance');
    L.marker(wp3Coords, { icon: wpIcon('WP-03 (Target)', '#B88932') }).addTo(this.map).bindPopup('<strong>WP-03</strong>: Valve Assembly (Current Target)');

    // Route Polyline
    const routeCoordinates = [wp1Coords, wp2Coords, roverCoords, wp3Coords];
    L.polyline(routeCoordinates, {
      color: 'var(--accent-gold)',
      weight: 3,
      dashArray: '6, 8',
      opacity: 0.85
    }).addTo(this.map);

    // Locate Rover Button Click Handler
    const locateBtn = document.getElementById('btnLocateRover');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        this.map.flyTo(roverCoords, 18, { duration: 1.2 });
        this.roverMarker.openPopup();
        this.logEvent('INFO', 'Map centered on ARGUS Rover position.');
      });
    }

    // Fix map rendering issues when container sizes change
    setTimeout(() => {
      this.map.invalidateSize();
    }, 400);
  }

  /* ------------------------------------------------------------- */
  /* Simulated Cameras Rendering (Demo Mode)                       */
  /* ------------------------------------------------------------- */
  initSimulatedCameras() {
    let t = 0;
    const render = () => {
      t += 0.02;
      if (this.isDemoMode) {
        this.drawSimCam(this.cam1Canvas, false, t);
        this.drawSimCam(this.cam2Canvas, true, t);
      }
      requestAnimationFrame(render);
    };
    render();
  }

  drawSimCam(canvas, showYolo, t) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 270;

    // Background gradient: corridor perspective
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#04070c');
    bgGrad.addColorStop(0.5, '#0b131e');
    bgGrad.addColorStop(1, '#020407');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const vanishX = w * 0.5;
    const vanishY = h * 0.44;

    // Floor perspective grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = -w * 0.5; x <= w * 1.5; x += 60) {
      ctx.beginPath();
      ctx.moveTo(vanishX, vanishY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Moving horizontal grid lines based on rover motion
    const speedFactor = this.activeCommand === 'F' ? 1.5 : this.activeCommand === 'B' ? -1.5 : 0.2;
    const offset = (t * 24 * speedFactor) % 40;
    for (let y = vanishY + 10; y < h; y += 24) {
      const cy = y + offset;
      if (cy >= vanishY && cy <= h) {
        const spread = (cy - vanishY) / (h - vanishY);
        ctx.beginPath();
        ctx.moveTo(vanishX - spread * (w * 0.5), cy);
        ctx.lineTo(vanishX + spread * (w * 0.5), cy);
        ctx.stroke();
      }
    }

    // Storage Rack Racks
    ctx.fillStyle = '#070f1a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.28, vanishY - 20);
    ctx.lineTo(w * 0.28, h);
    ctx.lineTo(0, h);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w * 0.72, vanishY - 20);
    ctx.lineTo(w * 0.72, h);
    ctx.lineTo(w, h);
    ctx.fill();

    // Chemical Drum in scene
    const drumX = w * 0.42 + Math.sin(t * 0.5) * 6;
    const drumY = h * 0.52;
    const drumW = 46;
    const drumH = 58;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(drumX, drumY, drumW, drumH);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(drumX, drumY, drumW, drumH);

    // Hazard stripe
    ctx.fillStyle = this.currentGas >= this.dangerLimit ? '#ef4444' : '#f59e0b';
    ctx.fillRect(drumX + 8, drumY + 14, 30, 8);

    // Worker / Person Silhouette
    const pX = w * 0.65;
    const pY = h * 0.46;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(pX + 12, pY - 6, 7, 0, Math.PI * 2);
    ctx.rect(pX + 4, pY + 2, 16, 26);
    ctx.fill();

    // Rover crosshair
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.beginPath();
    ctx.moveTo(vanishX - 18, vanishY);
    ctx.lineTo(vanishX + 18, vanishY);
    ctx.moveTo(vanishX, vanishY - 18);
    ctx.lineTo(vanishX, vanishY + 18);
    ctx.stroke();

    // AI Overlays (Only on Camera 2)
    if (showYolo) {
      // 1. Drum detection box
      const isHaz = this.currentGas >= this.dangerLimit;
      ctx.lineWidth = 2;
      ctx.strokeStyle = isHaz ? '#ef4444' : '#38bdf8';
      ctx.fillStyle = isHaz ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.1)';
      ctx.fillRect(drumX - 4, drumY - 4, drumW + 8, drumH + 8);
      ctx.strokeRect(drumX - 4, drumY - 4, drumW + 8, drumH + 8);

      ctx.fillStyle = isHaz ? '#ef4444' : '#38bdf8';
      ctx.fillRect(drumX - 4, drumY - 20, 114, 16);
      ctx.fillStyle = '#020617';
      ctx.font = '700 10px JetBrains Mono, monospace';
      ctx.fillText(isHaz ? 'HAZARD_DRUM 96%' : 'STORAGE_DRUM 94%', drumX, drumY - 8);

      // 2. Person detection box
      ctx.strokeStyle = '#22c55e';
      ctx.fillStyle = 'rgba(34, 197, 94, 0.08)';
      ctx.fillRect(pX - 2, pY - 16, 28, 48);
      ctx.strokeRect(pX - 2, pY - 16, 28, 48);

      ctx.fillStyle = '#22c55e';
      ctx.fillRect(pX - 2, pY - 32, 74, 16);
      ctx.fillStyle = '#020617';
      ctx.fillText('PERSON 92%', pX, pY - 20);

      // Scanline sweep
      const scanY = (t * 80) % h;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(w, scanY);
      ctx.stroke();
    }

    // CRT scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
  }

  /* ------------------------------------------------------------- */
  /* Event Log & CSV Export                                        */
  /* ------------------------------------------------------------- */
  logEvent(type, text) {
    const viewport = document.getElementById('eventLogViewport');
    if (!viewport) return;

    const timeStr = new Date().toTimeString().split(' ')[0];
    const row = document.createElement('div');
    row.className = 'log-row';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = timeStr;

    const msgSpan = document.createElement('span');
    msgSpan.className = `log-msg ${type === 'SAFETY' ? 'err' : type === 'WARN' ? 'warn' : type === 'INFO' ? 'info' : ''}`;
    msgSpan.innerHTML = text;

    row.appendChild(timeSpan);
    row.appendChild(msgSpan);
    viewport.appendChild(row);

    // Limit log size to 100 items
    while (viewport.children.length > 100) {
      viewport.removeChild(viewport.firstChild);
    }

    viewport.scrollTop = viewport.scrollHeight;
  }

  exportCsvLog() {
    if (this.gasHistory.length === 0) {
      this.logEvent('WARN', 'No telemetry records to export yet.');
      return;
    }

    let csvContent = 'time,gas_ppm,gas_raw,alarm_pin\n';
    this.gasHistory.forEach(row => {
      const isoTime = row.time.toISOString();
      csvContent += `"${isoTime}",${row.ppm},${row.raw},"${row.alarm}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `argus_gas_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.logEvent('INFO', `Telemetry log downloaded (${this.gasHistory.length} records).`);
  }

  escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
}

// Instantiate upon DOM readiness
document.addEventListener('DOMContentLoaded', () => {
  window.argusController = new ArgusController();
});
