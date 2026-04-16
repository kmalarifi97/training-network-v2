#!/bin/bash
set -euo pipefail

# Deploy GPU Network v2
# Usage: ./deploy.sh [control-plane|agent|all]

TARGET=${1:-all}
PROJECT=training-network-sa

deploy_control_plane() {
    echo "=== Deploying control plane (Doha) ==="
    gcloud compute ssh gpunet-server --zone=me-central1-a --project=$PROJECT --command="
        cd ~/gpu-network-v2 && \
        git pull origin main && \
        sudo docker compose up --build -d && \
        sleep 10 && \
        curl -s http://localhost:8000/health
    "
    echo ""
}

deploy_agent() {
    echo "=== Building agent binary ==="
    cd "$(dirname "$0")/node-agent"
    GOOS=linux GOARCH=amd64 go build -o /tmp/gpu-agent .

    echo "=== Deploying agent (Oregon) ==="
    gcloud compute scp /tmp/gpu-agent gpu-network-v1:~/gpu-agent \
        --zone=us-west1-a --project=$PROJECT
    gcloud compute ssh gpu-network-v1 --zone=us-west1-a --project=$PROJECT --command="
        sudo mv ~/gpu-agent /usr/local/bin/gpu-agent && \
        sudo chmod +x /usr/local/bin/gpu-agent && \
        sudo systemctl restart gpu-agent 2>/dev/null || echo 'Restart agent manually: gpu-agent start'
    "
    echo ""
}

case $TARGET in
    control-plane) deploy_control_plane ;;
    agent)         deploy_agent ;;
    all)           deploy_control_plane; deploy_agent ;;
    *)             echo "Usage: $0 [control-plane|agent|all]"; exit 1 ;;
esac

echo "=== Deploy complete ==="
