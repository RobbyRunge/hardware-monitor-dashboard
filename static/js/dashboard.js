// ── Status ─────────────────────────────────────────
document.getElementById("status-dot").className = "dot dot--live";
document.getElementById("status-text").textContent = "DEMO";

// ── History buffers ───────────────────────────────
const MAX_POINTS = 60;
const cpuHistory   = Array(MAX_POINTS).fill(0);
const ramHistory   = Array(MAX_POINTS).fill(0);
const readHistory  = Array(MAX_POINTS).fill(0);
const writeHistory = Array(MAX_POINTS).fill(0);
const gpuHistory   = Array(MAX_POINTS).fill(0);
const labels = Array.from({ length: MAX_POINTS }, (_, i) => `${MAX_POINTS - i}s`).reverse();

function pushHistory(data) {
    cpuHistory.push(data.cpu?.usage_total ?? 0);   cpuHistory.shift();
    ramHistory.push(data.ram?.percent ?? 0);        ramHistory.shift();
    readHistory.push(data.io?.read_mbs ?? 0);       readHistory.shift();
    writeHistory.push(data.io?.write_mbs ?? 0);     writeHistory.shift();
    gpuHistory.push(data.gpu?.gpu_busy_percent ?? 0); gpuHistory.shift();

    chartCPU.data.datasets[0].data = [...cpuHistory]; chartCPU.update("none");
    chartRAM.data.datasets[0].data = [...ramHistory]; chartRAM.update("none");
    chartIO.data.datasets[0].data  = [...readHistory];
    chartIO.data.datasets[1].data  = [...writeHistory]; chartIO.update("none");
    chartGPU.data.datasets[0].data = [...gpuHistory]; chartGPU.update("none");
}

// ── CPU updater ───────────────────────────────────
function tempColor(t) {
    if (t == null) return "#4a6272";
    if (t < 60)   return "#39ff8f";
    if (t < 80)   return "#ffcc00";
    return "#ff3b3b";
}

function updateCPU(cpu) {
    if (!cpu) return;
    setNum("cpu-total", cpu.usage_total, 1);
    setNum("cpu-freq",  cpu.freq_current, 0);

    const tempEl = document.getElementById("cpu-temp");
    tempEl.textContent = cpu.cpu_temp != null ? cpu.cpu_temp.toFixed(0) : "—";
    tempEl.style.color      = tempColor(cpu.cpu_temp);
    tempEl.style.textShadow = `0 0 20px ${tempColor(cpu.cpu_temp)}55`;

    setBar("bar-cpu", cpu.usage_total);
    setBar("bar-ram", cpu.ram_percent);

    document.getElementById("processes").textContent =
        cpu.process_count != null ? cpu.process_count : "—";

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
        const fill  = document.getElementById(`core-fill-${i}`);
        const label = document.getElementById(`core-pct-${i}`);
        if (fill) {
            fill.style.height     = `${pct}%`;
            fill.style.background = pct > 80 ? "#ff3b3b" : pct > 60 ? "#ffcc00" : "var(--accent)";
        }
        if (label) label.textContent = `${Math.round(pct)}%`;
    });
}

// ── RAM updater ───────────────────────────────────
function updateRAM(ram) {
    if (!ram) return;
    setNum("ram2-used",    ram.used_gb,      1);
    setNum("ram2-total",   ram.total_gb,     1);
    setNum("ram2-percent", ram.percent,      1);
    setNum("ram2-swap",    ram.swap_used_gb, 1);
    setBar("bar-ram2", ram.percent);

    const hw     = ram.hardware;
    const errBox = document.getElementById("ram-error");
    if (hw?.error) {
        errBox.style.display = "block";
        errBox.textContent   = "⚠ " + hw.error;
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

// ── GPU updater ───────────────────────────────────
function updateGPU(gpu) {
    if (!gpu) return;

    const errBox = document.getElementById("gpu-error");
    if (gpu.error) {
        errBox.style.display = "block";
        errBox.textContent   = "⚠ " + gpu.error;
    } else {
        errBox.style.display = "none";
    }

    const tempEl = document.getElementById("gpu-temp");
    tempEl.textContent  = gpu.temp_edge != null ? gpu.temp_edge.toFixed(0) : "—";
    tempEl.style.color      = tempColor(gpu.temp_edge);
    tempEl.style.textShadow = `0 0 20px ${tempColor(gpu.temp_edge)}55`;

    setNum("gpu-load",      gpu.gpu_busy_percent, 0);
    setBar("bar-gpu",       gpu.gpu_busy_percent);
    setNum("gpu-vram-used", gpu.vram_used_gb,     1);
    if (gpu.vram_total_gb) setBar("bar-vram", (gpu.vram_used_gb / gpu.vram_total_gb) * 100);
    setNum("gpu-power", gpu.power_w, 0);

    document.getElementById("gpu-temp-junction").textContent =
        gpu.temp_junction != null ? gpu.temp_junction.toFixed(0) : "—";
    document.getElementById("gpu-temp-mem").textContent =
        gpu.temp_mem != null ? gpu.temp_mem.toFixed(0) : "—";
    document.getElementById("gpu-clock").textContent =
        gpu.gpu_clock_mhz != null ? Math.round(gpu.gpu_clock_mhz) : "—";
    document.getElementById("gpu-mem-clock").textContent =
        gpu.mem_clock_mhz != null ? Math.round(gpu.mem_clock_mhz) : "—";
}

// ── NVMe updater ──────────────────────────────────
function updateNVMe(nvme, io) {
    if (!nvme) return;

    const errBox = document.getElementById("nvme-error");
    if (nvme.error) {
        errBox.style.display = "block";
        errBox.textContent   = "⚠ " + nvme.error;
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
        setNum("io-read",  io.read_mbs,  1);
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
    if (pct > 85)      el.style.background = "#ff3b3b";
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
            x: { display: false, grid: { display: false } },
            y: {
                min: 0,
                grid:  { color: "rgba(30,45,58,0.8)", lineWidth: 1 },
                ticks: { color: "#4a6272", font: { family: "'Share Tech Mono'", size: 10 }, maxTicksLimit: 5 },
                border: { color: "transparent" },
            },
        },
    },
};

const chartCPU = new Chart(document.getElementById("chart-cpu").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: { labels, datasets: [{ data: [...cpuHistory], borderColor: "#00e5ff", backgroundColor: "rgba(0,229,255,0.07)", borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 }] },
});
chartCPU.options.scales.y.max = 100; chartCPU.update();

const chartRAM = new Chart(document.getElementById("chart-ram").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: { labels, datasets: [{ data: [...ramHistory], borderColor: "#b36aff", backgroundColor: "rgba(179,106,255,0.07)", borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 }] },
});
chartRAM.options.scales.y.max = 100; chartRAM.update();

const chartIO = new Chart(document.getElementById("chart-io").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: { labels, datasets: [
        { label: "Read MB/s",  data: [...readHistory],  borderColor: "#39ff8f", backgroundColor: "rgba(57,255,143,0.07)",  borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 },
        { label: "Write MB/s", data: [...writeHistory], borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.07)", borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 },
    ]},
});

const chartGPU = new Chart(document.getElementById("chart-gpu").getContext("2d"), {
    ...JSON.parse(JSON.stringify(chartDefaults)),
    data: { labels, datasets: [{ data: [...gpuHistory], borderColor: "#ed1c24", backgroundColor: "rgba(237,28,36,0.07)", borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 }] },
});
chartGPU.options.scales.y.max = 100; chartGPU.update();

// ── Collapsible sections ───────────────────────────
function toggleSection(titleEl) {
    titleEl.closest('.section').classList.toggle('collapsed');
}

// ── Demo: Simulated Hardware State ────────────────
const sim = {
    cpuCores:        Array(16).fill(0).map(() => 8 + Math.random() * 15),
    cpuTemp:         52,
    cpuFreq:         4100,
    ramUsed:         18.4,
    gpuLoad:         6,
    gpuTemp:         57,
    gpuTempJunction: 65,
    gpuTempMem:      52,
    gpuPower:        42,
    gpuClock:        900,
    gpuMemClock:     2450,
    gpuVram:         3.1,
    nvmeTemp:        39,
    ioRead:          0,
    ioWrite:         0,
    processCount:    318,
};

let cpuSpike = 0;
let gpuSpike = 0;

function clamp(v, lo, hi)      { return Math.max(lo, Math.min(hi, v)); }
function noise(scale)          { return (Math.random() - 0.5) * scale; }
function drift(v, target, spd) { return v + (target - v) * spd; }

function tick() {
    // Occasional load spikes
    if (Math.random() < 0.025) cpuSpike = 25 + Math.random() * 45;
    if (Math.random() < 0.018) gpuSpike = 35 + Math.random() * 55;
    cpuSpike = cpuSpike * 0.82;
    gpuSpike = gpuSpike * 0.88;

    // CPU cores — each drifts independently, pulled by spike
    sim.cpuCores = sim.cpuCores.map(c => {
        const base = 6 + cpuSpike * (0.4 + Math.random() * 0.6);
        return clamp(drift(c, base, 0.18) + noise(5), 0, 100);
    });
    const avgCpu = sim.cpuCores.reduce((a, b) => a + b) / sim.cpuCores.length;

    // CPU temp tracks load with thermal lag
    sim.cpuTemp  = clamp(drift(sim.cpuTemp, 42 + avgCpu * 0.38, 0.09) + noise(0.4), 38, 95);
    sim.cpuFreq  = clamp(drift(sim.cpuFreq, 3600 + avgCpu * 14, 0.12) + noise(40), 3400, 5050);
    sim.processCount = clamp(sim.processCount + Math.round(noise(4)), 290, 370);

    // RAM — very stable, slow drift
    sim.ramUsed  = clamp(sim.ramUsed + noise(0.04), 17.0, 22.5);
    const ramTotal   = 32.0;
    const ramPercent = (sim.ramUsed / ramTotal) * 100;

    // GPU — load, temp, power, clocks all coupled
    sim.gpuLoad         = clamp(drift(sim.gpuLoad, 4 + gpuSpike, 0.22) + noise(2), 0, 100);
    sim.gpuTemp         = clamp(drift(sim.gpuTemp, 48 + sim.gpuLoad * 0.26, 0.07) + noise(0.3), 35, 95);
    sim.gpuTempJunction = clamp(sim.gpuTemp + 8 + noise(1), 35, 110);
    sim.gpuTempMem      = clamp(sim.gpuTemp - 6 + noise(1.5), 28, 90);
    sim.gpuPower        = clamp(drift(sim.gpuPower, 28 + sim.gpuLoad * 2.9, 0.14) + noise(4), 8, 310);
    sim.gpuClock        = clamp(drift(sim.gpuClock, 600 + sim.gpuLoad * 21, 0.11) + noise(25), 500, 2750);
    sim.gpuMemClock     = clamp(sim.gpuMemClock + noise(8), 2400, 2500);
    sim.gpuVram         = clamp(drift(sim.gpuVram, 2.4 + sim.gpuLoad * 0.11, 0.06) + noise(0.04), 1.2, 16.0);

    // NVMe temp — very stable
    sim.nvmeTemp = clamp(sim.nvmeTemp + noise(0.25), 34, 58);

    // Disk I/O — idle with occasional bursts (Samsung 990 Pro peaks ~7.4 GB/s)
    sim.ioRead  = Math.random() < 0.05
        ? 400 + Math.random() * 5800
        : clamp(sim.ioRead  * 0.55 + noise(8), 0, 7400);
    sim.ioWrite = Math.random() < 0.04
        ? 200 + Math.random() * 3200
        : clamp(sim.ioWrite * 0.55 + noise(5), 0, 6900);

    const data = {
        cpu: {
            usage_per_core: sim.cpuCores,
            usage_total:    avgCpu,
            cpu_temp:       sim.cpuTemp,
            freq_current:   sim.cpuFreq,
            freq_max:       5050,
            ram_percent:    ramPercent,
            process_count:  sim.processCount,
        },
        ram: {
            used_gb:        sim.ramUsed,
            total_gb:       ramTotal,
            available_gb:   ramTotal - sim.ramUsed,
            percent:        ramPercent,
            swap_used_gb:   0.1,
            swap_total_gb:  8.0,
            swap_percent:   1.3,
            hardware: {
                type:         "DDR5",
                speed_mhz:    6000,
                slots_used:   2,
                slots_total:  4,
                manufacturer: "SK Hynix",
                part_number:  "HMCG88MEBSA095N",
            },
        },
        gpu: {
            gpu_busy_percent: sim.gpuLoad,
            temp_edge:        sim.gpuTemp,
            temp_junction:    sim.gpuTempJunction,
            temp_mem:         sim.gpuTempMem,
            power_w:          sim.gpuPower,
            gpu_clock_mhz:    sim.gpuClock,
            mem_clock_mhz:    sim.gpuMemClock,
            vram_used_gb:     sim.gpuVram,
            vram_total_gb:    16.0,
        },
        nvme: {
            temperature:    sim.nvmeTemp,
            available_spare: 100,
            percentage_used: 1,
            data_read_gb:   12483.4,
            data_written_gb: 8291.7,
            power_on_hours: 2847,
            unsafe_shutdowns: 3,
        },
        io: {
            read_mbs:  sim.ioRead,
            write_mbs: sim.ioWrite,
        },
    };

    updateCPU(data.cpu);
    updateNVMe(data.nvme, data.io);
    updateRAM(data.ram);
    updateGPU(data.gpu);
    pushHistory(data);
    document.getElementById("last-update").textContent =
        "Last update: " + new Date().toLocaleTimeString("de-DE");
}

// Ersten Tick nach kurzer Pause, dann jede Sekunde
setTimeout(() => { tick(); setInterval(tick, 1000); }, 300);
