# Host a GPU on the network — Windows setup

This guide gets your Windows PC contributing GPU time to the network. It takes about 30 minutes the first time, most of which is Windows installing things in the background.

## What you need

- Windows 10 (build 19041+) or Windows 11
- An NVIDIA RTX / GTX GPU (tested on RTX 3060 and up)
- A recent NVIDIA driver from `nvidia.com/drivers` (any driver from 2023+ supports CUDA-on-WSL)
- Admin access on your machine
- A claim token from Khalid (he sends you one over WhatsApp)

You do **not** need to uninstall anything, stop gaming, or reboot into Linux. Everything runs alongside Windows.

---

## Step 1 — Install WSL2 (one-time, ~10 minutes)

Open **PowerShell as administrator** (right-click Start menu → "Terminal (Admin)" or "PowerShell (Admin)").

Paste:

```powershell
wsl --install -d Ubuntu
```

Windows will download Ubuntu and ask to **reboot**. Save your games, then reboot.

After reboot, an Ubuntu terminal window opens automatically. It asks you to pick a Linux username and password — pick anything you'll remember.

> **Heads up:** that Linux username/password is separate from your Windows login. You only need it inside the Ubuntu terminal.

---

## Step 2 — Install Docker + NVIDIA toolkit inside Ubuntu (one-time, ~5 minutes)

Inside that Ubuntu terminal, paste this block:

```bash
# Docker Engine
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io

# NVIDIA Container Toolkit (so Docker can see your GPU)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo service docker restart
```

Check it worked:

```bash
nvidia-smi
```

You should see your GPU model and memory listed. If you get "command not found" your NVIDIA driver on the Windows side is outdated — update it from `nvidia.com/drivers` and try again.

```bash
sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

This confirms Docker can also see your GPU. If it works, you see the same table as the last command.

---

## Step 3 — Install the gpu-agent (30 seconds)

Still in the Ubuntu terminal:

```bash
curl -fsSL http://34.18.164.66:8000/public/install.sh | sudo bash
```

This downloads the agent binary, installs it to `/usr/local/bin/gpu-agent`, and writes a systemd service.

---

## Step 4 — Register your machine (10 seconds)

Replace `<YOUR_TOKEN>` with the claim token Khalid sent you:

```bash
sudo gpu-agent init \
    --config=/etc/gpu-agent/config.json \
    --control-plane=http://34.18.164.66:8000 \
    --claim-token=<YOUR_TOKEN>
```

You should see:

```
Detected 1 GPU(s): NVIDIA GeForce RTX 3080, 10 GB each
Node registered as <UUID>
Config written to /etc/gpu-agent/config.json
```

---

## Step 5 — Start the agent

```bash
sudo systemctl enable --now gpu-agent
```

That's it. The agent now runs in the background, restarts automatically if it crashes, and survives reboots.

Confirm it's alive by tailing the logs:

```bash
sudo journalctl -u gpu-agent -f
```

You should see heartbeat messages every 10 seconds. Press `Ctrl+C` to stop tailing (the agent keeps running).

---

## Managing the agent

| Action | Command |
|---|---|
| Check status | `sudo systemctl status gpu-agent` |
| Tail live logs | `sudo journalctl -u gpu-agent -f` |
| Stop temporarily | `sudo systemctl stop gpu-agent` |
| Start again | `sudo systemctl start gpu-agent` |
| Disable on boot | `sudo systemctl disable gpu-agent` |
| Uninstall | `sudo systemctl disable --now gpu-agent && sudo rm /usr/local/bin/gpu-agent /etc/systemd/system/gpu-agent.service` |

---

## Troubleshooting

**`nvidia-smi: command not found`** — Your NVIDIA driver on Windows is too old. Update to any driver from 2023 or later at `nvidia.com/drivers`. You do not install an NVIDIA driver *inside* WSL — the Windows driver exposes the GPU through to WSL automatically.

**`docker: Cannot connect to the Docker daemon`** — Run `sudo service docker start`. WSL2 doesn't auto-start Docker like a native Linux install; add `sudo service docker start` to your `~/.bashrc` if it keeps happening.

**`docker: Error response from daemon: could not select device driver "" with capabilities: [[gpu]]`** — The nvidia-container-toolkit didn't register with Docker. Re-run:
```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo service docker restart
```

**Agent logs say `ErrNvidiaSmiMissing`** — `nvidia-smi` isn't on the PATH for the systemd service. Check `which nvidia-smi` — if it's not at `/usr/local/bin/` or `/usr/bin/`, symlink it:
```bash
sudo ln -s "$(which nvidia-smi)" /usr/local/bin/nvidia-smi
sudo systemctl restart gpu-agent
```

**Agent heartbeats but never claims a job** — This is normal when no one has submitted a job yet. Ask Khalid to test-submit one.

**Windows Update broke WSL GPU access** — This happens occasionally when Windows updates the NVIDIA driver. Reboot once; if still broken, roll back the driver in Device Manager.

---

## Shutting down cleanly (e.g., before a long trip)

If you want to take your machine offline without deleting your node record:

```bash
sudo systemctl stop gpu-agent
```

The network marks your node "offline" after ~60 seconds and won't assign jobs to it until you restart.

To permanently remove your machine from the network:

```bash
# From the web UI, mark your node "drained" and then "delete".
# This frees the slot; you can always re-register later with a new claim token.
```
