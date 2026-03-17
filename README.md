# 🖥️ Hardware Monitor Dashboard

A lightweight web dashboard for real-time system metrics — optimized for the **AMD Ryzen 7 7800X3D**, **AMD Radeon RX 7800 XT**, and the **Samsung 990 Pro NVMe**.

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.x-black?logo=flask)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

- **CPU**: Overall & per-core usage, temperature (Tctl/Tdie), clock frequency
- **RAM**: Usage, hardware info (type, speed, slots, manufacturer) read from SPD EEPROM
- **GPU**: Load, temperature (edge/junction/VRAM), VRAM usage, power draw, clocks — via amdgpu sysfs, no root required
- **NVMe**: Temperature, health, total data read/written, power-on hours, unsafe shutdowns
- **Disk I/O**: Live read/write in MB/s
- **Live history**: 60-second charts for CPU load, RAM usage, GPU load and disk throughput
- **WebSocket updates** every second — no polling

---

## Prerequisites

### System packages (Fedora/Nobara)

```bash
sudo dnf install lm_sensors nvme-cli
sudo sensors-detect --auto
```

> **GPU data** is read directly from the kernel's `amdgpu` sysfs interface — no additional tools or root access needed.

### NVMe permissions (one-time setup)

```bash
# Option A – Add user to the disk group (recommended)
sudo usermod -a -G disk $USER
# Log out and back in afterwards!

# Option B – Allow nvme without password via sudoers
sudo visudo
# Add the line:
# yourUsername ALL=(ALL) NOPASSWD: /usr/bin/nvme
```

### Python dependencies

```bash
pip install -r requirements.txt
```

---

## Running

```bash
bash start-dashboard.sh
```

This starts the Flask server and opens the dashboard automatically in your browser.

Alternatively, run manually:

```bash
python dashboard.py
```

Then open: [http://localhost:5000](http://localhost:5000)

---

## Project structure

```
hardware-monitor-dashboard/
├── dashboard.py          # Flask backend + WebSocket server
├── requirements.txt
├── templates/
│   └── index.html        # Dashboard UI
└── static/
    ├── css/style.css     # Dark industrial theme
    └── js/dashboard.js   # Live updates & charts
```

---

## Tech stack

| Component | Technology |
|---|---|
| Backend | Python 3, Flask, Flask-SocketIO |
| CPU/RAM data | psutil + lm_sensors |
| GPU data | amdgpu sysfs (`/sys/class/drm/`) |
| NVMe data | nvme-cli |
| Frontend | Vanilla JS, Chart.js 4, Socket.IO |
| Live transport | WebSocket |

---

## License

MIT
