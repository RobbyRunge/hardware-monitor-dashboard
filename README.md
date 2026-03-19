# Hardware Monitor Dashboard

A lightweight real-time system monitor running as a local web dashboard — built for the **AMD Ryzen 7 7800X3D**, **AMD Radeon RX 7800 XT**, **SK Hynix DDR5-6000** and the **Samsung 990 Pro NVMe**.

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.x-black?logo=flask)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

| Section | Metrics |
|---|---|
| **CPU** | Overall & per-core load, Tctl/Tdie temperature, clock frequency, process count |
| **RAM** | Usage (used/total/%), swap, hardware info (type, speed, slots, manufacturer) read directly from SPD EEPROM — no root required |
| **GPU** | Load, edge/junction/VRAM temperature, VRAM usage, power draw, GPU & memory clocks — via `amdgpu` sysfs, no root required |
| **NVMe** | Temperature, drive health (available spare), total data read/written, power-on hours, unsafe shutdowns |
| **Disk I/O** | Live read/write throughput in MB/s |

**UI**
- 60-second history charts (Chart.js) for CPU load, RAM, GPU load and disk I/O
- Per-core usage bars with color-coded load and temperature indicators
- Collapsible sections — open only what you need
- WebSocket push every second — no polling, no page refresh

---

## Requirements

### System packages (Fedora / Nobara)

```bash
sudo dnf install lm_sensors nvme-cli
sudo sensors-detect --auto
```

> **GPU data** is read from the kernel's `amdgpu` sysfs interface — no tools or root access needed.

### NVMe sudo permissions (one-time)

`nvme smart-log` requires root. Choose one option:

```bash
# Option A — add user to disk group (recommended, survives reboots)
sudo usermod -a -G disk $USER
# Log out and back in afterwards

# Option B — passwordless sudo for nvme only
sudo visudo
# Add: yourUsername ALL=(ALL) NOPASSWD: /usr/bin/nvme
```

### Python dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Running

```bash
bash start-dashboard.sh
```

Opens the dashboard automatically in your browser at `http://localhost:5000`.

Or manually:

```bash
source .venv/bin/activate
python dashboard.py
```

---

## Project structure

```
hardware-monitor-dashboard/
├── dashboard.py            # Flask backend + WebSocket server + all data collectors
├── start-dashboard.sh      # One-click start script
├── requirements.txt
├── templates/
│   └── index.html          # Dashboard UI (Flask template)
└── static/
    ├── css/style.css        # Dark industrial theme (Share Tech Mono + Barlow)
    └── js/dashboard.js      # Socket.IO client, Chart.js charts, DOM updates
```

---

## How the data collection works

| Source | Used for |
|---|---|
| `psutil` | CPU usage, frequency, RAM usage, disk I/O |
| `lm_sensors` (`sensors -j`) | CPU temperature (Tctl/Tdie via k10temp) |
| `/sys/bus/i2c/devices/*/eeprom` | RAM hardware info from SPD EEPROM (DDR5, speed via EXPO profile, manufacturer via JEDEC code) |
| `/sys/class/drm/card*/device` | GPU utilization, VRAM, clocks, power, temperatures |
| `nvme smart-log` (via sudo) | NVMe SMART data |

---

## Tech stack

| Component | Technology |
|---|---|
| Backend | Python 3, Flask, Flask-SocketIO (threading mode) |
| Frontend | Vanilla JS, Chart.js 4, Socket.IO client |
| Live transport | WebSocket |
| CPU/RAM/IO | psutil + lm_sensors |
| GPU | amdgpu sysfs |
| NVMe | nvme-cli |

---

## Demo / Static deploy

The `demo` branch contains a fully static version of the dashboard (no Python, no server) for deployment on static web hosting. All metrics are simulated with a realistic random-walk model including load spikes, thermal lag and I/O bursts.

Files to upload: `index.html`, `static/css/style.css`, `static/js/dashboard.js`

---

## License

MIT
