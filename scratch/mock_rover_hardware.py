"""
ARGUS Physical Hardware Mock Simulator (Python 3)
Simulates:
1. ESP32 Motor Controller REST API (Port 8080)
   - GET /ping -> {"status": "ok", "uptime": 3600, "firmware": "ARGUS_ESP32_v1.4"}
   - GET /cmd?dir=F&speed=180 -> {"ack": true, "cmd": "F", "speed": 180}
2. Raspberry Pi 5 Sensor & Telemetry Server (Port 5001)
   - GET /data -> Telemetry JSON (Gas, Pressure, Temp, Battery, GPS, AI Detections)
   - GET /mode?m=auto|manual -> {"mode": "AUTONOMOUS"}
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import random
import threading
import time
import urllib.parse

# 1. ESP32 Motor Controller Simulator
class ESP32Handler(BaseHTTPRequestHandler):
    active_cmd = "S"
    speed = 0

    def do_GET(self):
        parsed = urllib.parse.urlparse(this_path := self.path)
        params = urllib.parse.parse_qs(parsed.query)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if parsed.path == '/ping':
            resp = {"status": "ok", "uptime": int(time.time()), "firmware": "ARGUS_ESP32_v1.4"}
        elif parsed.path == '/cmd':
            cmd = params.get('dir', ['S'])[0]
            spd = int(params.get('speed', [180])[0])
            ESP32Handler.active_cmd = cmd
            ESP32Handler.speed = spd
            print(f"[ESP32 Hardware] Received Drive Command: {cmd} @ Speed {spd}")
            resp = {"ack": True, "cmd": cmd, "speed": spd, "exec_time_ms": 12}
        else:
            resp = {"error": "Unknown ESP32 endpoint"}

        self.wfile.write(json.dumps(resp).encode('utf-8'))

    def log_message(self, format, *args):
        pass # Suppress verbose logs

# 2. Raspberry Pi 5 Telemetry & Camera Server Simulator
class Pi5Handler(BaseHTTPRequestHandler):
    gas_ppm = 240.0
    pressure_kpa = 101.3
    mode = "MANUAL"

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if parsed.path == '/data':
            # Fluctuating sensor values
            Pi5Handler.gas_ppm = max(80.0, min(1400.0, Pi5Handler.gas_ppm + random.uniform(-4, 4)))
            Pi5Handler.pressure_kpa = round(max(98.0, min(104.0, Pi5Handler.pressure_kpa + random.uniform(-0.03, 0.03))), 1)

            resp = {
                "hardware": "Raspberry Pi 5 Model B",
                "status": "ONLINE",
                "gas": round(Pi5Handler.gas_ppm, 1),
                "gas_raw": int(Pi5Handler.gas_ppm * 48.2 + random.randint(10, 30)),
                "gas_alarm": Pi5Handler.gas_ppm >= 400,
                "pressure": Pi5Handler.pressure_kpa,
                "pressure_unit": "kPa",
                "temp": 34.2,
                "battery": 88,
                "mode": Pi5Handler.mode,
                "lat": 28.6139,
                "lng": 77.2090,
                "cpu": 22.4,
                "uptime": "02:14:08",
                "labels": ["PERSON", "OIL_DRUM"],
                "sensor_status": {
                    "mq4_gas": "READY",
                    "bmp280_pressure": "ACTIVE",
                    "neo6m_gps": "LOCKED"
                }
            }
        elif parsed.path == '/mode':
            Pi5Handler.mode = params.get('m', ['manual'])[0].upper()
            print(f"[Pi 5 Hardware] Operating Mode updated to: {Pi5Handler.mode}")
            resp = {"status": "ACKNOWLEDGED", "mode": Pi5Handler.mode}
        else:
            resp = {"error": "Unknown Pi 5 endpoint"}

        self.wfile.write(json.dumps(resp).encode('utf-8'))

    def log_message(self, format, *args):
        pass

def run_esp32_server():
    server = HTTPServer(('127.0.0.1', 8080), ESP32Handler)
    print("[ESP32] Hardware Simulator listening on http://127.0.0.1:8080")
    server.serve_forever()

def run_pi5_server():
    server = HTTPServer(('127.0.0.1', 5001), Pi5Handler)
    print("[Pi 5] Telemetry Simulator listening on http://127.0.0.1:5001")
    server.serve_forever()

if __name__ == '__main__':
    t1 = threading.Thread(target=run_esp32_server, daemon=True)
    t2 = threading.Thread(target=run_pi5_server, daemon=True)
    t1.start()
    t2.start()
    print("ARGUS Physical Hardware Simulators Active. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Hardware Simulators stopped.")
