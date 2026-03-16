// ── Socket.IO ─────────────────────────────────────
const socket = io();

socket.on("connect", () => {
    document.getElementById("status-dot").className = "dot dot--live";
    document.getElementById("status-text").textContent = "LIVE";
});

socket.on("disconnect", () => {
    document.getElementById("status-dot").className = "dot dot--connecting";
    document.getElementById("status-text").textContent = "Reconnecting…";
});

socket.on("hw_update", (data) => {
    if (data.error) {
        console.error("Server error:", data.error);
        return;
    }
    updateCPU(data.cpu);
    updateNVMe(data.nvme, data.io);
    updateRAM(data.ram);
    pushHistory(data);
    document.getElementById("last-update").textContent =
        "Last update: " + new Date().toLocaleTimeString("de-DE");
});

// ── History buffers ───────────────────────────────
const MAX_POINTS = 60;
const cpuHistory = Array(MAX_POINTS).fill(0);
const ramHistory = Array(MAX_POINTS).fill(0);
const readHistory = Array(MAX_POINTS).fill(0);
const writeHistory = Array(MAX_POINTS).fill(0);
const labels = Array.from({ length: MAX_POINTS }, (_, i) => `${MAX_POINTS - i}s`).reverse();

function pushHistory(data) {
    cpuHistory.push(data.cpu?.usage_total ?? 0);
    cpuHistory.shift();
    ramHistory.push(data.ram?.percent ?? 0);
    ramHistory.shift();
    readHistory.push(data.io?.read_mbs ?? 0);
    readHistory.shift();
    writeHistory.push(data.io?.write_mbs ?? 0);
    writeHistory.shift();

    chartCPU.data.datasets[0].data = [...cpuHistory];
    chartCPU.update("none");

    chartRAM.data.datasets[0].data = [...ramHistory];
    chartRAM.update("none");

    chartIO.data.datasets[0].data = [...readHistory];
    chartIO.data.datasets[1].data = [...writeHistory];
    chartIO.update("none");
}

// ── CPU updater ───────────────────────────────────
function tempColor(t) {
    if (t == null) return "#4a6272";
    if (t < 60) return "#39ff8f";
    if (t < 80) return "#ffcc00";
    return "#ff3b3b";
}

function updateCPU(cpu) {
    if (!cpu) return;

    setNum("cpu-total", cpu.usage_total, 1);
    setNum("cpu-freq", cpu.freq_current, 0);

    // Temperature
    const tempEl = document.getElementById("cpu-temp");
    tempEl.textContent = cpu.cpu_temp != null ? cpu.cpu_temp.toFixed(0) : "—";
    tempEl.style.color = tempColor(cpu.cpu_temp);
    tempEl.style.textShadow = `0 0 20px ${tempColor(cpu.cpu_temp)}55`;

    // Progress bars
    setBar("bar-cpu", cpu.usage_total);
    setBar("bar-ram", cpu.ram_percent);

    // Processes
    document.getElementById("processes").textContent =
        cpu.process_count != null ? cpu.process_count : "—";

    // Per-core
    renderCores(cpu.usage_per_core);
}

function renderCores(cores) {
    if (!cores || !cores.length) return;
    const grid = document.getElementById("core-grid");
    if (grid.children.length !== cores.length) {
        grid.innerHTML = "";
        cores.forEach((_, i) => {
            grid.innerHTML += `
        <div class="core-item">
          <div class="core-bar-wrap">
            <div class="core-bar-fill" id="core-fill-${i}"></div>
          </div>
          <span class="core-label">C${i}</span>
          <span class="core-pct" id="core-pct-${i}">0%</span>
        </div>`;
        });
    }
    cores.forEach((pct, i) => {
        const fill = document.getElementById(`core-fill-${i}`);
        const label = document.getElementById(`core-pct-${i}`);
        if (fill) {
            fill.style.height = `${pct}%`;
            fill.style.background = pct > 80 ? "#ff3b3b" : pct > 60 ? "#ffcc00" : "var(--accent)";
        }
        if (label) label.textContent = `${Math.round(pct)}%`;
    });
}

// ── RAM updater ───────────────────────────────────
function updateRAM(ram) {
    if (!ram) return;

    setNum("ram2-used", ram.used_gb, 1);
    setNum("ram2-total", ram.total_gb, 1);
    setNum("ram2-percent", ram.percent, 1);
    setNum("ram2-swap", ram.swap_used_gb, 1);
    setBar("bar-ram2", ram.percent);

    const hw = ram.hardware;
    const errBox = document.getElementById("ram-error");
    if (hw?.error) {
        errBox.style.display = "block";
        errBox.textContent = "⚠ " + hw.error;
    } else {
        errBox.style.display = "none";
    }

    if (hw && !hw.error) {
        document.getElementById("ram-type").textContent =
            hw.type ?? "—";
        document.getElementById("ram-speed").textContent =
            hw.speed_mhz != null ? `${hw.speed_mhz} MT/s` : "—";
        document.getElementById("ram-slots").textContent =
            hw.slots_used != null ? `${hw.slots_used} / ${hw.slots_total}` : "—";
        document.getElementById("ram-manufacturer").textContent =
            hw.manufacturer ?? "—";
        document.getElementById("ram-part").textContent =
            hw.part_number ?? "—";
    }
}

// ── NVMe updater ──────────────────────────────────
function updateNVMe(nvme, io) {
    if (!nvme) return;

    const errBox = document.getElementById("nvme-error");
    if (nvme.error) {
        errBox.style.display = "block";
        errBox.textContent = "⚠ " + nvme.error;
    } else {
        errBox.style.display = "none";
    }

    setNum("nvme-temp", nvme.temperature, 0);
    const health = nvme.available_spare != null ? nvme.available_spare : null;
    document.getElementById("nvme-health").textContent = health != null ? health : "—";

    document.getElementById("nvme-read-total").textContent =
        nvme.data_read_gb != null ? `${nvme.data_read_gb.toLocaleString("de-DE")} GB` : "—";
    document.getElementById("nvme-write-total").textContent =
        nvme.data_written_gb != null ? `${nvme.data_written_gb.toLocaleString("de-DE")} GB` : "—";
    document.getElementById("nvme-poh").textContent =
        nvme.power_on_hours != null ? `${nvme.power_on_hours} h` : "—";
    document.getElementById("nvme-shutdowns").textContent =
        nvme.unsafe_shutdowns != null ? nvme.unsafe_shutdowns : "—";

    if (io) {
        setNum("io-read", io.read_mbs, 1);
        setNum("io-write", io.write_mbs, 1);
    }
}

// ── Helpers ───────────────────────────────────────
function setNum(id, val, decimals = 1) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val != null ? Number(val).toFixed(decimals) : "—";
}

function setBar(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.width = `${Math.min(100, pct || 0)}%`;
    if (pct > 85) el.style.background = "#ff3b3b";
    else if (pct > 65) el.style.background = "#ffcc00";
}

// ── Charts ────────────────────────────────────────
const chartDefaults = {
    type: "line",
    options: {
        animation: false,
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
            x: {
                display: false,
                grid: { display: false },
            },
            y: {
                min: 0,
                grid: {
                    color: "rgba(30,45,58,0.8)",
                    lineWidth: 1,
                },
                ticks: {
                    color: "#4a6272",
                    font: { family: "'Share Tech Mono'", size: 10 },
                    maxTicksLimit: 5,
                },
                border: { color: "transparent" },
            },
        },
    },
};

// CPU chart
const chartCPU = new Chart(document.getElementById("chart-cpu").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: {
        labels,
        datasets: [{
            data: [...cpuHistory],
            borderColor: "#00e5ff",
            backgroundColor: "rgba(0,229,255,0.07)",
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
        }],
    },
});
chartCPU.options.scales.y.max = 100;
chartCPU.update();

// RAM chart
const chartRAM = new Chart(document.getElementById("chart-ram").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: {
        labels,
        datasets: [{
            data: [...ramHistory],
            borderColor: "#b36aff",
            backgroundColor: "rgba(179,106,255,0.07)",
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
        }],
    },
});
chartRAM.options.scales.y.max = 100;
chartRAM.update();

// I/O chart
const chartIO = new Chart(document.getElementById("chart-io").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: {
        labels,
        datasets: [
            {
                label: "Read MB/s",
                data: [...readHistory],
                borderColor: "#39ff8f",
                backgroundColor: "rgba(57,255,143,0.07)",
                borderWidth: 1.5,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
            },
            {
                label: "Write MB/s",
                data: [...writeHistory],
                borderColor: "#ff6b35",
                backgroundColor: "rgba(255,107,53,0.07)",
                borderWidth: 1.5,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
            },
        ],
    },
});

// ── Collapsible sections ───────────────────────────
function toggleSection(titleEl) {
    titleEl.closest('.section').classList.toggle('collapsed');
}
