import subprocess
import json
import re
import struct
import glob
import threading
import time
import psutil
from flask import Flask, render_template
from flask_socketio import SocketIO

app = Flask(__name__)
app.config["SECRET_KEY"] = "hw-monitor-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

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
        "process_count": len(psutil.pids()),
    }


# ──────────────────────────────────────────
#  NVMe helpers  (Samsung 990 Pro)
# ──────────────────────────────────────────

def find_nvme_device():
    """Return controller path of the 990 Pro (or first available NVMe)."""
    try:
        result = subprocess.run(
            ["nvme", "list", "-o", "json"],
            capture_output=True, text=True, timeout=3
        )
        data = json.loads(result.stdout)
        devices = data.get("Devices", [])
        # Prefer 990 Pro, fall back to first device
        target = next(
            (d for d in devices if "990" in d.get("ModelNumber", "")),
            devices[0] if devices else None
        )
        if target:
            # Convert namespace path (/dev/nvme1n1) to controller (/dev/nvme1)
            path = target["DevicePath"]
            return re.sub(r"n\d+$", "", path)
    except Exception:
        pass
    return "/dev/nvme0"


NVME_DEV = find_nvme_device()


# ──────────────────────────────────────────
#  RAM helpers
# ──────────────────────────────────────────

_ram_hw_cache: dict | None = None
_ram_hw_last: float = 0.0


_DRAM_TYPES = {0x12: "DDR5", 0x0C: "DDR4", 0x0B: "DDR3", 0x0F: "LPDDR5"}

# JEDEC JEP106 Bank 1 manufacturer bytes (bits 0-6 = code, bit 7 = odd parity)
_JEDEC_MFR = {
    0x2C: "Micron",
    0xAD: "SK Hynix",
    0xCE: "Samsung",
    0x9E: "Kingston",
    0x43: "Ramaxel",
    0x04: "Fujitsu",
}


def get_ram_hardware():
    """Read RAM hardware info from SPD EEPROM via sysfs — no sudo needed. Cached 60 s."""
    global _ram_hw_cache, _ram_hw_last
    now = time.time()
    if _ram_hw_cache is not None and now - _ram_hw_last < 60:
        return _ram_hw_cache

    result: dict = {
        "slots": [],
        "type": None,
        "speed_mhz": None,
        "slots_used": None,
        "slots_total": None,
        "manufacturer": None,
        "part_number": None,
        "error": None,
    }
    try:
        # Total slots from DMI entries (readable without sudo)
        dmi_entries = glob.glob("/sys/firmware/dmi/entries/17-*")
        result["slots_total"] = len(dmi_entries) if dmi_entries else None

        # SPD EEPROM files — filter to spd* drivers only (spd5118, eeprom_spd …)
        filled = []
        for eeprom_path in sorted(glob.glob("/sys/bus/i2c/devices/*/eeprom")):
            dev_dir = eeprom_path.rsplit("/", 1)[0]
            try:
                name = open(dev_dir + "/name").read().strip()
            except OSError:
                continue
            if "spd" not in name.lower():
                continue
            try:
                data = open(eeprom_path, "rb").read(1024)
            except OSError:
                continue
            if len(data) < 0x16:
                continue

            dram_type = _DRAM_TYPES.get(data[0x02], f"0x{data[0x02]:02x}")

            # EXPO profile speed (AMD OC profile) — signature "EXPO" + 0x0E bytes offset
            expo_idx = data.find(b"EXPO")
            if expo_idx >= 0 and len(data) >= expo_idx + 0x10:
                tck_ps = struct.unpack_from("<H", data, expo_idx + 0x0E)[0]
            else:
                # Fallback: JEDEC tCKAVGmin — DDR5 SPD bytes 0x14-0x15 (little-endian)
                tck_ps = struct.unpack_from("<H", data, 0x14)[0]

            speed = round(2_000_000 / tck_ps / 100) * 100 if tck_ps else None

            # Manufacturer: scan JEDEC code at known offsets (0x1FE, 0x229 on DDR5)
            manufacturer = None
            for off in (0x141, 0x140, 0x1FE, 0x229):
                if off < len(data):
                    manufacturer = _JEDEC_MFR.get(data[off])
                    if manufacturer:
                        break

            # Part number: first ASCII string starting with alnum and containing a letter
            part_number = None
            for m in re.finditer(rb'[A-Za-z0-9][A-Za-z0-9 \-_.]{5,}', data):
                s = m.group().decode("ascii").strip()
                if any(c.isalpha() for c in s):
                    part_number = s
                    break

            filled.append({
                "type": dram_type,
                "speed_mt": speed,
                "manufacturer": manufacturer,
                "part_number": part_number,
                "dev": dev_dir.split("/")[-1],
            })

        result["slots_used"] = len(filled)
        if filled:
            result["type"] = filled[0]["type"]
            result["speed_mhz"] = filled[0]["speed_mt"]
            result["manufacturer"] = filled[0]["manufacturer"]
            result["part_number"] = filled[0]["part_number"]
            result["slots"] = filled

    except Exception as e:
        result["error"] = str(e)

    _ram_hw_cache = result
    _ram_hw_last = now
    return result


def get_ram_data():
    """Combined RAM usage + hardware info."""
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    hw = get_ram_hardware()
    return {
        "used_gb": round(mem.used / 1024**3, 1),
        "total_gb": round(mem.total / 1024**3, 1),
        "available_gb": round(mem.available / 1024**3, 1),
        "percent": mem.percent,
        "swap_used_gb": round(swap.used / 1024**3, 1),
        "swap_total_gb": round(swap.total / 1024**3, 1),
        "swap_percent": swap.percent,
        "hardware": hw,
    }


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
            ["sudo", "nvme", "smart-log", NVME_DEV, "-o", "json"],
            capture_output=True, text=True, timeout=3
        )
        if result.returncode != 0:
            data["error"] = result.stderr.strip() or result.stdout.strip() or "nvme command failed"
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
            ram = get_ram_data()
            payload = {"cpu": cpu, "nvme": nvme, "io": io, "ram": ram}
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
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
