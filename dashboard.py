import subprocess
import json
import re
import threading
import time
import psutil
from flask import Flask, render_template
from flask_socketio import SocketIO

app = Flask(__name__)
app.config["SECRET_KEY"] = "hw-monitor-secret"
socketio = SocketIO(app, cors_allowed_origins="*")

# ──────────────────────────────────────────
#  CPU / System helpers
# ──────────────────────────────────────────

def get_cpu_data():
    """Collect Ryzen 7800X3D metrics via psutil + lm_sensors."""
    freq = psutil.cpu_freq(percpu=False)
    per_core_usage = psutil.cpu_percent(percpu=True)
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    # lm_sensors for temperatures
    temps = {}
    try:
        result = subprocess.run(["sensors", "-j"], capture_output=True, text=True, timeout=2)
        raw = json.loads(result.stdout)
        for chip, data in raw.items():
            for key, val in data.items():
                if isinstance(val, dict):
                    for metric, reading in val.items():
                        if "input" in metric and isinstance(reading, (int, float)):
                            label = f"{chip} – {key}"
                            temps[label] = round(reading, 1)
    except Exception:
        pass

    # Try to get Tctl/Tdie for Ryzen specifically
    cpu_temp = None
    for label, val in temps.items():
        if "tctl" in label.lower() or "tdie" in label.lower() or "k10temp" in label.lower():
            cpu_temp = val
            break
    if cpu_temp is None and temps:
        cpu_temp = next(iter(temps.values()))

    return {
        "usage_per_core": per_core_usage,
        "usage_total": round(sum(per_core_usage) / len(per_core_usage), 1),
        "freq_current": round(freq.current, 0) if freq else None,
        "freq_max": round(freq.max, 0) if freq else None,
        "cpu_temp": cpu_temp,
        "all_temps": temps,
        "ram_total": round(mem.total / 1024**3, 1),
        "ram_used": round(mem.used / 1024**3, 1),
        "ram_percent": mem.percent,
        "swap_used": round(swap.used / 1024**3, 1),
        "swap_percent": swap.percent,
    }


# ──────────────────────────────────────────
#  NVMe helpers  (Samsung 990 Pro)
# ──────────────────────────────────────────

def find_nvme_device():
    """Return first available nvme device path."""
    for dev in ["/dev/nvme0", "/dev/nvme1", "/dev/nvme0n1"]:
        try:
            result = subprocess.run(
                ["nvme", "list", "-o", "json"],
                capture_output=True, text=True, timeout=3
            )
            data = json.loads(result.stdout)
            devices = data.get("Devices", [])
            if devices:
                return devices[0].get("DevicePath", "/dev/nvme0")
        except Exception:
            pass
    return "/dev/nvme0"


NVME_DEV = find_nvme_device()


def get_nvme_data():
    """Read SMART log from NVMe via nvme-cli."""
    data = {
        "device": NVME_DEV,
        "temperature": None,
        "available_spare": None,
        "percentage_used": None,
        "data_read_gb": None,
        "data_written_gb": None,
        "power_on_hours": None,
        "unsafe_shutdowns": None,
        "error": None,
    }
    try:
        result = subprocess.run(
            ["nvme", "smart-log", NVME_DEV, "-o", "json"],
            capture_output=True, text=True, timeout=3
        )
        if result.returncode != 0:
            data["error"] = result.stderr.strip() or "nvme command failed"
            return data

        raw = json.loads(result.stdout)
        # Temperature is in Kelvin × 8 (some drives) or straight Celsius
        temp_raw = raw.get("temperature", 0)
        # Kelvin to Celsius
        temp_c = temp_raw - 273 if temp_raw > 200 else temp_raw
        data["temperature"] = round(temp_c, 1)
        data["available_spare"] = raw.get("avail_spare", None)
        data["percentage_used"] = raw.get("percent_used", None)
        # Units: 1 unit = 512,000 bytes = 0.512 MB ≈ 0.0005 GB
        units_read = raw.get("data_units_read", 0)
        units_written = raw.get("data_units_written", 0)
        data["data_read_gb"] = round(units_read * 512000 / 1e9, 1)
        data["data_written_gb"] = round(units_written * 512000 / 1e9, 1)
        data["power_on_hours"] = raw.get("power_on_hours", None)
        data["unsafe_shutdowns"] = raw.get("unsafe_shutdowns", None)
    except FileNotFoundError:
        data["error"] = "nvme-cli not found – run: sudo dnf install nvme-cli"
    except json.JSONDecodeError:
        data["error"] = "Could not parse nvme output"
    except Exception as e:
        data["error"] = str(e)

    return data


def get_disk_io():
    """Disk read/write speed (bytes/s) via psutil."""
    io1 = psutil.disk_io_counters()
    time.sleep(0.5)
    io2 = psutil.disk_io_counters()
    if io1 and io2:
        read_speed = (io2.read_bytes - io1.read_bytes) * 2  # per second
        write_speed = (io2.write_bytes - io1.write_bytes) * 2
        return {
            "read_mbs": round(read_speed / 1e6, 1),
            "write_mbs": round(write_speed / 1e6, 1),
        }
    return {"read_mbs": 0, "write_mbs": 0}


# ──────────────────────────────────────────
#  Background broadcast thread
# ──────────────────────────────────────────

def broadcast_loop():
    while True:
        try:
            cpu = get_cpu_data()
            nvme = get_nvme_data()
            io = get_disk_io()
            payload = {"cpu": cpu, "nvme": nvme, "io": io}
            socketio.emit("hw_update", payload)
        except Exception as e:
            socketio.emit("hw_update", {"error": str(e)})
        time.sleep(1)


@app.route("/")
def index():
    return render_template("index.html")


@socketio.on("connect")
def on_connect():
    print("Client connected")


if __name__ == "__main__":
    t = threading.Thread(target=broadcast_loop, daemon=True)
    t.start()
    print("Dashboard running at http://localhost:5000")
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
