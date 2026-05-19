#!/usr/bin/env bash
# Tinyproxy setup for an Ubuntu VM (tested on Oracle Cloud Mumbai always-free tier).
#
# Usage (run on the VM, as root):
#   sudo bash setup-tinyproxy.sh <proxy-username> <proxy-password>
#
# After it finishes:
#   1. In Oracle Cloud console, open the VCN -> Security List -> add ingress rule:
#        Source 0.0.0.0/0, TCP, dest port 8888
#   2. From your laptop, sanity-check:
#        curl -x http://<user>:<pass>@<vm-public-ip>:8888 https://api.ipify.org
#      Should print an Indian IP (the VM's public IP).
#   3. Add three GitHub Actions secrets in the repo:
#        PROXY_SERVER   = http://<vm-public-ip>:8888
#        PROXY_USERNAME = <user>
#        PROXY_PASSWORD = <pass>
set -euo pipefail

USER="${1:?Usage: $0 <proxy-username> <proxy-password>}"
PASS="${2:?Usage: $0 <proxy-username> <proxy-password>}"
PORT=8888

apt-get update
apt-get install -y tinyproxy iptables-persistent

cat > /etc/tinyproxy/tinyproxy.conf <<EOF
User tinyproxy
Group tinyproxy
Port ${PORT}
Listen 0.0.0.0
Timeout 600
DefaultErrorFile "/usr/share/tinyproxy/default.html"
StatFile "/usr/share/tinyproxy/stats.html"
LogFile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Info
PidFile "/run/tinyproxy/tinyproxy.pid"
MaxClients 100
BasicAuth ${USER} ${PASS}
ConnectPort 443
ConnectPort 563
EOF

systemctl enable tinyproxy
systemctl restart tinyproxy

# Oracle Ubuntu images ship with a restrictive iptables INPUT chain; punch a hole.
iptables -I INPUT 5 -p tcp --dport ${PORT} -j ACCEPT || true
netfilter-persistent save || true

echo
echo "tinyproxy is up on port ${PORT}."
echo "Now open port ${PORT} TCP in the Oracle VCN security list, then test:"
echo "  curl -x http://${USER}:${PASS}@\$(curl -s ifconfig.me):${PORT} https://api.ipify.org"
