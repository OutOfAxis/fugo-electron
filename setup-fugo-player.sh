#!/bin/bash
set -e

curl -fsSL https://repo.cloud.fugo.ai/fugo-repo.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/fugo-repo.gpg

sudo tee /etc/apt/sources.list.d/fugo.list > /dev/null <<EOF
deb [signed-by=/usr/share/keyrings/fugo-repo.gpg] https://repo.cloud.fugo.ai/ stable main
EOF

sudo apt update
sudo apt install -y fugo-player
